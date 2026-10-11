import { all, get } from '../db/index.js';

const pad = (n) => String(n).padStart(2, '0');

function parseYm(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{1,2})/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { y: Number(m[1]), m: month - 1 };
}

export function monthKeysBetween(startDate, endDate = new Date()) {
  const start = parseYm(startDate);
  if (!start) return [];
  const end = endDate instanceof Date ? { y: endDate.getFullYear(), m: endDate.getMonth() } : parseYm(endDate);
  if (!end) return [];
  const keys = [];
  let cur = start.y * 12 + start.m;
  const last = end.y * 12 + end.m;
  while (cur <= last && keys.length < 120) {
    const y = Math.floor(cur / 12);
    const m = cur % 12;
    keys.push(`${y}-${pad(m + 1)}`);
    cur += 1;
  }
  return keys;
}

export function expandCoverage(payments) {
  const covered = new Set();
  payments.forEach((p) => {
    if (!p.period || p.status !== 'completed') return;
    const ym = parseYm(p.period);
    if (!ym) return;
    let idx = ym.y * 12 + ym.m;
    const months = Math.max(1, Number(p.months_covered || 1));
    for (let i = 0; i < months && i < 120; i += 1) {
      covered.add(`${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`);
      idx += 1;
    }
  });
  return covered;
}

const EPS = 0.5;

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function leaseCoverage(lease) {
  if (!lease) return { unpaidPeriods: [], months: 0, total: 0, credit: 0, coverage: [] };
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const rental = Number(lease.rent || 0);

  const startYm = parseYm(lease.start_date);
  const startIdx = startYm ? startYm.y * 12 + startYm.m : nowIdx;
  const endYm = parseYm(lease.end_date);
  const leaseEndIdx = endYm ? endYm.y * 12 + endYm.m : nowIdx;

  const accrualEndIdx = lease.status === 'active' ? nowIdx : Math.min(nowIdx, leaseEndIdx);

  const payments = all(
    `SELECT id, amount, period, months_covered, status, paid_at, created_at FROM payments WHERE lease_id = ?`,
    [lease.id]
  ).filter((p) => p.status === 'completed');

  let scheduleEndIdx = Math.max(nowIdx, leaseEndIdx);
  payments.forEach((p) => {
    const ym = parseYm(p.period);
    if (!ym) return;
    const start = ym.y * 12 + ym.m;
    const months = Math.max(1, Number(p.months_covered || 1));
    scheduleEndIdx = Math.max(scheduleEndIdx, start + months - 1);
  });
  scheduleEndIdx = Math.min(scheduleEndIdx, Math.max(nowIdx, leaseEndIdx) + 120);

  const periods = [];
  for (let i = startIdx; i <= scheduleEndIdx; i += 1) {
    periods.push({ idx: i, key: `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`, paid: 0 });
  }

  const sorted = [...payments].sort((a, b) => {
    const ta = a.paid_at || a.created_at || '';
    const tb = b.paid_at || b.created_at || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  let credit = 0;
  sorted.forEach((p) => {
    let amount = Number(p.amount || 0);
    if (amount <= 0) return;
    const ym = parseYm(p.period);
    let i = ym ? periods.findIndex((x) => x.idx === ym.y * 12 + ym.m) : -1;
    if (i === -1) i = periods.findIndex((x) => x.paid < rental - EPS);
    if (i === -1) i = periods.length - 1;
    while (i < periods.length && amount > EPS) {
      const need = rental - periods[i].paid;
      if (need <= EPS) {
        i += 1;
        continue;
      }
      const take = Math.min(need, amount);
      periods[i].paid += take;
      amount -= take;
      i += 1;
    }
    credit += Math.max(0, amount);
  });

  const unpaidPeriods = [];
  let total = 0;
  periods.forEach((pr) => {
    if (pr.idx > accrualEndIdx) return;
    const deficit = rental - pr.paid;
    if (deficit > EPS) {
      unpaidPeriods.push(pr.key);
      total += deficit;
    }
  });

  return {
    unpaidPeriods,
    months: unpaidPeriods.length,
    total: round2(total),
    credit: round2(credit),
    coverage: periods.map((pr) => {
      const outstanding = rental - pr.paid;
      return {
        period: pr.key,
        charge: rental,
        paid: round2(pr.paid),
        outstanding: round2(Math.max(0, outstanding)),
        status: pr.idx > accrualEndIdx ? 'future' : outstanding > EPS ? (pr.paid > EPS ? 'partial' : 'unpaid') : 'paid',
      };
    }),
  };
}

export function leaseArrears(lease) {
  const s = leaseCoverage(lease);
  return { unpaidPeriods: s.unpaidPeriods, months: s.months, total: s.total, credit: s.credit };
}

export function activeLeaseOfTenant(tenantId) {
  return get(
    `SELECT l.*, p.name AS property_name, p.images AS property_images, p.county, p.area,
            u.unit_number, u.floor, u.unit_type, u.rent AS unit_rent, u.status AS unit_status
     FROM leases l
     JOIN properties p ON p.id = l.property_id
     JOIN units u ON u.id = l.unit_id
     WHERE l.tenant_id = ? AND l.status = 'active'
     ORDER BY l.created_at DESC LIMIT 1`,
    [tenantId]
  );
}

export function activeLeaseOfUnit(unitId) {
  return get(`SELECT * FROM leases WHERE unit_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [unitId]);
}

export function landlordPropertyIds(landlordId) {
  return all('SELECT id FROM properties WHERE landlord_id = ?', [landlordId]).map((r) => r.id);
}

export function caretakerPropertyIds(caretakerId) {
  return all('SELECT property_id FROM property_caretakers WHERE caretaker_id = ?', [caretakerId]).map((r) => r.property_id);
}

export function isCaretakerOfProperty(userId, propertyId) {
  return Boolean(
    get('SELECT 1 AS x FROM property_caretakers WHERE caretaker_id = ? AND property_id = ?', [userId, propertyId])
  );
}

export function managedPropertyIds(user) {
  if (!user) return [];
  if (user.role === 'admin') return all('SELECT id FROM properties').map((r) => r.id);
  if (user.role === 'landlord') return landlordPropertyIds(user.id);
  if (user.role === 'caretaker') return caretakerPropertyIds(user.id);
  return [];
}

export function placeholders(list) {
  return list.map(() => '?').join(',') || 'NULL';
}

export function landlordStats(landlordId) {
  const ids = landlordPropertyIds(landlordId);
  if (!ids.length) {
    return {
      properties: 0,
      units: 0,
      occupied: 0,
      vacant: 0,
      expectedRent: 0,
      collectedThisMonth: 0,
      outstanding: 0,
      pendingMaintenance: 0,
      occupancyRate: 0,
      expensesTotal: 0,
      expensesMonth: 0,
    };
  }
  const ph = placeholders(ids);
  const unitRow = get(
    `SELECT COUNT(*) AS units,
            SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) AS vacant
     FROM units WHERE property_id IN (${ph})`,
    ids
  );
  const expected = get(
    `SELECT COALESCE(SUM(l.rent), 0) AS total FROM leases l WHERE l.property_id IN (${ph}) AND l.status = 'active'`,
    ids
  );
  const monthStart = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-01`;
  const collected = get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
     WHERE property_id IN (${ph}) AND status = 'completed' AND paid_at >= ?`,
    [...ids, monthStart]
  );
  const leases = all(`SELECT * FROM leases WHERE property_id IN (${ph}) AND status = 'active'`, ids);
  const outstanding = leases.reduce((sum, l) => sum + leaseArrears(l).total, 0);
  const pending = get(
    `SELECT COUNT(*) AS c FROM maintenance_requests WHERE property_id IN (${ph}) AND status NOT IN ('completed','closed')`,
    ids
  );
  const expenses = get(
    `SELECT COALESCE(SUM(amount),0) AS total,
            COALESCE(SUM(CASE WHEN date(expense_date) >= date('now','start of month') THEN amount ELSE 0 END),0) AS month
     FROM expenses WHERE property_id IN (${ph})`,
    ids
  );
  const units = Number(unitRow.units || 0);
  const occupied = Number(unitRow.occupied || 0);
  return {
    properties: ids.length,
    units,
    occupied,
    vacant: Number(unitRow.vacant || 0),
    expectedRent: Number(expected.total || 0),
    collectedThisMonth: Number(collected.total || 0),
    outstanding,
    pendingMaintenance: Number(pending.c || 0),
    occupancyRate: units ? Math.round((occupied / units) * 100) : 0,
    expensesTotal: Number(expenses.total || 0),
    expensesMonth: Number(expenses.month || 0),
  };
}

export function tenantStats(tenantId) {
  const lease = activeLeaseOfTenant(tenantId);
  if (!lease) {
    return { lease: null, arrears: { unpaidPeriods: [], total: 0, months: 0 }, paidThisMonth: 0, totalPaid: 0, nextDue: null };
  }
  const arrears = leaseArrears(lease);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const paid = get(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE tenant_id = ? AND status = 'completed' AND paid_at >= ?`,
    [tenantId, monthStart]
  );
  const totalPaid = get(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE tenant_id = ? AND status = 'completed'`, [
    tenantId,
  ]);
  const dueDay = Number(lease.start_date?.slice(8, 10) || 1);
  const nextDue = arrears.total > 0 ? new Date().toISOString().slice(0, 10) : `${now.getFullYear()}-${pad(now.getMonth() + 2)}-${pad(dueDay)}`;
  return {
    lease,
    arrears,
    paidThisMonth: Number(paid.total || 0),
    totalPaid: Number(totalPaid.total || 0),
    nextDue,
  };
}

export function propertyStats(propertyId) {
  const unitRow = get(
    `SELECT COUNT(*) AS units,
            SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) AS vacant
     FROM units WHERE property_id = ?`,
    [propertyId]
  );
  const rentRow = get(
    `SELECT COALESCE(SUM(rent),0) AS rent FROM units WHERE property_id = ?`,
    [propertyId]
  );
  const units = Number(unitRow.units || 0);
  const occupied = Number(unitRow.occupied || 0);
  return {
    units,
    occupied,
    vacant: Number(unitRow.vacant || 0),
    potentialRent: Number(rentRow.rent || 0),
    occupancyRate: units ? Math.round((occupied / units) * 100) : 0,
  };
}

export function paymentTrend(landlordIds, months = 6) {
  const rows = all(
    `SELECT strftime('%Y-%m', paid_at) AS ym, COALESCE(SUM(amount),0) AS total
     FROM payments
     WHERE status = 'completed' AND property_id IN (${placeholders(landlordIds)})
     GROUP BY ym ORDER BY ym`,
    landlordIds
  );
  const map = Object.fromEntries(rows.map((r) => [r.ym, Number(r.total)]));
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    out.push({
      period: key,
      label: d.toLocaleDateString('en-KE', { month: 'short' }),
      collected: map[key] || 0,
    });
  }
  return out;
}
