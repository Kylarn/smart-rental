import { all, get } from '../db/index.js';
import { notify } from './notify.js';
import { leaseArrears } from './rent.js';

function setting(key, fallback) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

export function runRentReminders() {
  const leases = all(`SELECT * FROM leases WHERE status = 'active'`);
  const now = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);
  let created = 0;

  leases.forEach((lease) => {
    const arrears = leaseArrears(lease);
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dueDay = Number(lease.start_date?.slice(8, 10) || 1);
    const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
    if (dueDate < new Date(lease.start_date)) return;
    const daysUntilDue = Math.ceil((dueDate - now) / 86400000);
    const tenant = get('SELECT id, full_name FROM users WHERE id = ?', [lease.tenant_id]);
    if (!tenant) return;

    if (daysUntilDue > 0 && daysUntilDue <= 3 && !arrears.unpaidPeriods.includes(currentPeriod)) {
      const id = notify(lease.tenant_id, {
        type: 'reminder',
        title: 'Rent due soon',
        body: `KES ${Number(lease.rent).toLocaleString('en-KE')} rent for ${currentPeriod} is due on ${ymd(dueDate)}.`,
        link: '/tenant/payments',
        dedupeKey: `rent-due-${lease.id}-${currentPeriod}`,
      });
      if (id) created += 1;
    } else if (daysUntilDue <= 0 && arrears.total > 0) {
      const id = notify(lease.tenant_id, {
        type: 'warning',
        title: 'Rent overdue',
        body: `You have KES ${arrears.total.toLocaleString('en-KE')} in arrears (${arrears.months} month${arrears.months === 1 ? '' : 's'}). Please clear your balance.`,
        link: '/tenant/payments',
        dedupeKey: `rent-overdue-${lease.id}-${currentPeriod}`,
      });
      if (id) created += 1;
      if (lease.property_id) {
        all('SELECT landlord_id FROM properties WHERE id = ?', [lease.property_id]).forEach((p) => {
          const n = notify(p.landlord_id, {
            type: 'warning',
            title: 'Tenant in arrears',
            body: `${tenant.full_name} owes KES ${arrears.total.toLocaleString('en-KE')} on Unit ${lease.unit_id}.`,
            link: '/landlord/payments',
            dedupeKey: `rent-overdue-ll-${lease.id}-${currentPeriod}`,
          });
          if (n) created += 1;
        });
      }
    }
  });
  return created;
}

export function runLeaseExpiryCheck() {
  const days = Number(setting('lease_expiry_days', 30));
  const leases = all(
    `SELECT l.*, p.name AS property_name, u.unit_number, t.full_name AS tenant_name
     FROM leases l JOIN properties p ON p.id = l.property_id JOIN units u ON u.id = l.unit_id
     JOIN users t ON t.id = l.tenant_id
     WHERE l.status = 'active' AND date(l.end_date) <= date('now', '+' || ? || ' days')
       AND date(l.end_date) >= date('now')`,
    [days]
  );
  let created = 0;
  leases.forEach((l) => {
    const key = `lease-expiry-${l.id}-${l.end_date}`;
    const n1 = notify(l.tenant_id, {
      type: 'warning',
      title: 'Lease expiring soon',
      body: `Your lease for Unit ${l.unit_number} at ${l.property_name} ends on ${l.end_date}.`,
      link: '/tenant/lease',
      dedupeKey: key,
    });
    const n2 = notify(l.landlord_id, {
      type: 'warning',
      title: 'Lease expiring soon',
      body: `${l.tenant_name}'s lease for Unit ${l.unit_number} ends on ${l.end_date}.`,
      link: '/landlord/leases',
      dedupeKey: `${key}-ll`,
    });
    if (n1) created += 1;
    if (n2) created += 1;
  });
  return created;
}

let timer = null;

export function startScheduler() {
  const tick = () => {
    try {
      const a = runRentReminders();
      const b = runLeaseExpiryCheck();
      if (a || b) console.log(`[scheduler] created ${a} rent + ${b} lease notifications`);
    } catch (err) {
      console.error('[scheduler] error', err);
    }
  };
  tick();
  timer = setInterval(tick, 6 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
