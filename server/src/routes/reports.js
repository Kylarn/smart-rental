import express from 'express';
import { all, get } from '../db/index.js';
import { asyncHandler, badRequest, parseJson } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { landlordStats, leaseArrears, paymentTrend, landlordPropertyIds, caretakerPropertyIds, placeholders } from '../services/rent.js';

const router = express.Router();
router.use(requireAuth, requireRole('landlord', 'admin', 'caretaker'));

function scopeIds(req) {
  if (req.user.role === 'admin') return all('SELECT id FROM properties').map((p) => p.id);
  if (req.user.role === 'caretaker') return caretakerPropertyIds(req.user.id);
  return landlordPropertyIds(req.user.id);
}

function assertInScope(id, ids) {
  if (!ids.includes(id)) throw badRequest('You do not have access to this property');
}

function knownUnits(row) {
  return Number(row.total || 0) - Number(row.unknown || 0);
}

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const ids = scopeIds(req);
    const ph = placeholders(ids);
    const params = ids.length ? ids : [-1];
    const from = req.query.from || `${new Date().getFullYear() - 1}-01-01`;
    const to = req.query.to || new Date().toISOString().slice(0, 10);

    const stats = req.user.role === 'admin' ? platformStats() : req.user.role === 'caretaker' ? caretakerScopeStats(ids) : landlordStats(req.user.id);

    const incomeByProperty = ids.length
      ? all(
          `SELECT p.id, p.name, p.county, p.area,
                  (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS units,
                  (SELECT COALESCE(SUM(rent),0) FROM leases WHERE property_id = p.id AND status = 'active') AS expected_monthly,
                  (SELECT COALESCE(SUM(amount),0) FROM payments WHERE property_id = p.id AND status = 'completed'
                     AND date(paid_at) BETWEEN ? AND ?) AS income,
                  (SELECT COALESCE(SUM(actual_cost),0) FROM maintenance_requests WHERE property_id = p.id
                     AND actual_cost IS NOT NULL AND date(created_at) BETWEEN ? AND ?) AS maintenance_cost,
                  (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE property_id = p.id
                     AND date(expense_date) BETWEEN ? AND ?) AS expenses
           FROM properties p WHERE p.id IN (${ph}) ORDER BY income DESC`,
          [from, to, from, to, from, to, ...params]
        )
      : [];

    const expensesByCategory = ids.length
      ? all(
          `SELECT e.category, COUNT(*) AS records, COALESCE(SUM(e.amount),0) AS total
           FROM expenses e WHERE e.property_id IN (${ph})
             AND date(e.expense_date) BETWEEN ? AND ?
           GROUP BY e.category ORDER BY total DESC`,
          [from, to, ...params]
        )
      : [];

    const maintenanceByCategory = ids.length
      ? all(
          `SELECT category, COUNT(*) AS requests, COALESCE(SUM(COALESCE(actual_cost, estimated_cost)),0) AS cost
           FROM maintenance_requests WHERE property_id IN (${ph}) GROUP BY category ORDER BY requests DESC`,
          params
        )
      : [];

    const methodSplit = ids.length
      ? all(
          `SELECT method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount
           FROM payments WHERE status = 'completed' AND property_id IN (${ph}) GROUP BY method`,
          params
        )
      : [];

    const arrears = ids.length
      ? all(
          `SELECT l.*, t.full_name AS tenant_name, t.phone, u.unit_number, u.unit_type, p.name AS property_name
           FROM leases l JOIN users t ON t.id = l.tenant_id JOIN units u ON u.id = l.unit_id
           JOIN properties p ON p.id = l.property_id
           WHERE l.status = 'active' AND l.property_id IN (${ph})`,
          params
        )
          .map((l) => ({
            lease_id: l.id,
            tenant_id: l.tenant_id,
            tenant_name: l.tenant_name,
            phone: l.phone,
            unit_number: l.unit_number,
            property_name: l.property_name,
            rent: l.rent,
            ...leaseArrears(l),
          }))
          .filter((a) => a.total > 0)
          .sort((a, b) => b.total - a.total)
      : [];

    res.json({
      stats,
      trends: paymentTrend(ids, 12),
      incomeByProperty,
      maintenanceByCategory,
      expensesByCategory,
      methodSplit,
      arrears,
      period: { from, to },
    });
  })
);

function caretakerScopeStats(ids) {
  const ph = placeholders(ids);
  const params = ids.length ? ids : [-1];
  const props = get(`SELECT COUNT(*) AS c FROM properties WHERE id IN (${ph})`, params).c;
  const units = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='occupied' THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN status='vacant' AND occupancy_known=1 THEN 1 ELSE 0 END) AS vacant,
            SUM(CASE WHEN COALESCE(occupancy_known,1)=0 THEN 1 ELSE 0 END) AS unknown
     FROM units WHERE property_id IN (${ph})`,
    params
  );
  const expected = get(
    `SELECT COALESCE(SUM(rent),0) AS c FROM leases WHERE status='active' AND property_id IN (${ph})`,
    params
  ).c;
  const leases = all(
    `SELECT l.* FROM leases l WHERE l.status='active' AND l.property_id IN (${ph})`,
    params
  );
  const arrearsTotal = leases.reduce((s, l) => s + leaseArrears(l).total, 0);
  const maintenanceOpen = get(
    `SELECT COUNT(*) AS c FROM maintenance_requests WHERE status NOT IN ('completed','closed') AND property_id IN (${ph})`,
    params
  ).c;
  const pendingMoveOuts = get(
    `SELECT COUNT(*) AS c FROM move_outs WHERE status='initiated' AND property_id IN (${ph})`,
    params
  ).c;
  const expenseRow = get(
    `SELECT COALESCE(SUM(amount),0) AS total,
            COALESCE(SUM(CASE WHEN date(expense_date) >= date('now','start of month') THEN amount ELSE 0 END),0) AS month
     FROM expenses WHERE property_id IN (${ph})`,
    params
  );
  const known = knownUnits(units);
  return {
    properties: Number(props),
    units: Number(units.total),
    occupied: Number(units.occupied),
    vacant: Number(units.vacant || 0),
    unknown: Number(units.unknown || 0),
    occupancyRate: known ? Math.round((units.occupied / known) * 100) : 0,
    vacancyRate: known ? Math.round(((known - units.occupied) / known) * 100) : 0,
    expectedRent: Number(expected),
    outstanding: arrearsTotal,
    pendingMaintenance: Number(maintenanceOpen),
    pendingMoveOuts: Number(pendingMoveOuts),
    expensesTotal: Number(expenseRow?.total || 0),
    expensesMonth: Number(expenseRow?.month || 0),
  };
}

function platformStats() {
  const payments = get(
    `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN amount END),0) AS collected,
            COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed
     FROM payments`
  );
  const units = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='occupied' THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN COALESCE(occupancy_known,1)=0 THEN 1 ELSE 0 END) AS unknown
     FROM units`
  );
  const known = knownUnits(units);
  return {
    properties: get('SELECT COUNT(*) AS c FROM properties').c,
    units: Number(units.total),
    occupied: Number(units.occupied),
    unknown: Number(units.unknown || 0),
    vacancyRate: known ? Math.round(((known - units.occupied) / known) * 100) : 0,
    expectedRent: get(`SELECT COALESCE(SUM(rent),0) AS c FROM leases WHERE status = 'active'`).c,
    collectedThisMonth: get(
      `SELECT COALESCE(SUM(amount),0) AS c FROM payments WHERE status='completed' AND paid_at >= strftime('%Y-%m-01')`
    ).c,
    collected: Number(payments.collected),
    occupancyRate: known ? Math.round((units.occupied / known) * 100) : 0,
    outstanding: 0,
    pendingMaintenance: get(`SELECT COUNT(*) AS c FROM maintenance_requests WHERE status NOT IN ('completed','closed')`).c,
    expensesTotal: get(`SELECT COALESCE(SUM(amount),0) AS c FROM expenses`).c,
    expensesMonth: get(
      `SELECT COALESCE(SUM(amount),0) AS c FROM expenses WHERE date(expense_date) >= date('now','start of month')`
    ).c,
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const type = req.query.type || 'payments';
    const ids = scopeIds(req);
    const ph = placeholders(ids);
    const params = ids.length ? ids : [-1];
    let rows = [];

    if (type === 'payments') {
      rows = all(
        `SELECT pay.receipt_number, pay.amount, pay.method, pay.status, pay.period, pay.paid_at, pay.created_at,
                t.full_name AS tenant, p.name AS property, u.unit_number
         FROM payments pay JOIN users t ON t.id = pay.tenant_id
         LEFT JOIN properties p ON p.id = pay.property_id LEFT JOIN units u ON u.id = pay.unit_id
         WHERE pay.property_id IN (${ph}) ORDER BY pay.created_at DESC`,
        params
      );
    } else if (type === 'tenants') {
      rows = all(
        `SELECT t.full_name, t.email, t.phone, p.name AS property, u.unit_number, l.start_date, l.end_date,
                l.rent, l.frequency, l.status
         FROM leases l JOIN users t ON t.id = l.tenant_id
         JOIN properties p ON p.id = l.property_id JOIN units u ON u.id = l.unit_id
         WHERE p.id IN (${ph}) ORDER BY t.full_name`,
        params
      );
    } else if (type === 'properties') {
      rows = all(
        `SELECT p.name, p.county, p.area, p.property_type, p.status,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS units,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id AND status='occupied') AS occupied,
                (SELECT COALESCE(SUM(amount),0) FROM payments WHERE property_id = p.id AND status='completed') AS total_income
         FROM properties p WHERE p.id IN (${ph}) ORDER BY p.name`,
        params
      );
    } else if (type === 'arrears') {
      rows = all(
        `SELECT t.full_name AS tenant, t.phone, p.name AS property, u.unit_number, l.rent, l.end_date
         FROM leases l JOIN users t ON t.id = l.tenant_id
         JOIN properties p ON p.id = l.property_id JOIN units u ON u.id = l.unit_id
         WHERE l.status = 'active' AND p.id IN (${ph})`,
        params
      );
    } else if (type === 'maintenance') {
      rows = all(
        `SELECT m.title, m.category, m.priority, m.status, m.created_at, m.actual_cost,
                p.name AS property, u.unit_number, t.full_name AS tenant
         FROM maintenance_requests m JOIN properties p ON p.id = m.property_id
         LEFT JOIN units u ON u.id = m.unit_id LEFT JOIN users t ON t.id = m.tenant_id
         WHERE p.id IN (${ph}) ORDER BY m.created_at DESC`,
        params
      );
    } else if (type === 'expenses') {
      rows = all(
        `SELECT e.expense_date, e.category, e.description, e.amount, e.vendor, e.notes,
                p.name AS property, u.unit_number
         FROM expenses e JOIN properties p ON p.id = e.property_id
         LEFT JOIN units u ON u.id = e.unit_id
         WHERE e.property_id IN (${ph}) ORDER BY e.expense_date DESC, e.id DESC`,
        params
      );
    } else {
      throw badRequest('Unknown report type');
    }

    const filename = `smart-rentals-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(toCsv(rows));
  })
);

router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const ids = scopeIds(req);
    const ph = placeholders(ids);
    const params = [];
    const where = [`a.property_id IN (${ph})`];
    if (ids.length) params.push(...ids);

    if (req.query.property_id) {
      const pid = Number(req.query.property_id);
      assertInScope(pid, ids);
      where.push('a.property_id = ?');
      params.push(pid);
    }
    if (req.query.from) {
      where.push(`date(a.created_at) >= date(?)`);
      params.push(String(req.query.from).slice(0, 10));
    }
    if (req.query.to) {
      where.push(`date(a.created_at) <= date(?)`);
      params.push(String(req.query.to).slice(0, 10));
    }
    if (req.query.actor_id) {
      where.push('a.user_id = ?');
      params.push(Number(req.query.actor_id));
    }
    if (req.query.action) {
      where.push('a.action LIKE ?');
      params.push(`%${req.query.action}%`);
    }
    if (req.query.entity) {
      where.push('a.entity = ?');
      params.push(req.query.entity);
    }

    const rows = all(
      `SELECT a.id, a.user_id, a.action, a.entity, a.entity_id, a.details, a.ip, a.property_id, a.actor_role, a.created_at,
              u.full_name AS user_name, u.avatar_url AS user_avatar, p.name AS property_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN properties p ON p.id = a.property_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ activity: rows.map((r) => ({ ...r, details: parseJson(r.details, null) })) });
  })
);

router.get(
  '/caretakers',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const landlordScope =
      isAdmin ? '' : ' AND p.landlord_id = ?';
    const rows = all(
      `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status, u.created_at,
              (SELECT COUNT(*) FROM property_caretakers lpc JOIN properties lp ON lp.id = lpc.property_id
               WHERE lpc.caretaker_id = u.id${
                 isAdmin ? '' : ' AND lp.landlord_id = ?'
               }) AS properties_assigned,
              (SELECT COUNT(*) FROM property_caretakers WHERE caretaker_id = u.id) AS total_assigned
       FROM users u
       WHERE u.role = 'caretaker'${
         isAdmin
           ? ''
           : ` AND (
                EXISTS (SELECT 1 FROM property_caretakers pc2 JOIN properties p2 ON p2.id = pc2.property_id
                       WHERE pc2.caretaker_id = u.id AND p2.landlord_id = ?)
                OR NOT EXISTS (SELECT 1 FROM property_caretakers pc3 WHERE pc3.caretaker_id = u.id)
              )`
       }
       ORDER BY u.full_name`,
      isAdmin ? [] : [req.user.id, req.user.id]
    );
    const assignments = all(
      `SELECT pc.id, pc.caretaker_id, pc.created_at, p.id AS property_id, p.name AS property_name, p.status AS property_status,
              (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS units,
              (SELECT COUNT(*) FROM units WHERE property_id = p.id AND status = 'occupied') AS occupied
       FROM property_caretakers pc JOIN properties p ON p.id = pc.property_id
       WHERE 1=1${landlordScope}
       ORDER BY p.name`,
      isAdmin ? [] : [req.user.id]
    );
    const perCaretaker = {};
    assignments.forEach((a) => {
      if (!perCaretaker[a.caretaker_id]) perCaretaker[a.caretaker_id] = [];
      perCaretaker[a.caretaker_id].push(a);
    });
    res.json({
      caretakers: rows.map((r) => ({ ...r, properties: perCaretaker[r.id] || [] })),
    });
  })
);

export default router;
