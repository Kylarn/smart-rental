import express from 'express';
import { all, get } from '../db/index.js';
import { asyncHandler } from '../utils/helpers.js';
import { requireAuth } from '../middleware/auth.js';
import {
  landlordStats,
  tenantStats,
  activeLeaseOfTenant,
  leaseArrears,
  paymentTrend,
  landlordPropertyIds,
  caretakerPropertyIds,
  placeholders,
} from '../services/rent.js';
import { unreadCount } from '../services/notify.js';

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    let payload;
    if (req.user.role === 'landlord') payload = { role: 'landlord', ...(await landlordDashboard(req.user.id)) };
    else if (req.user.role === 'caretaker') payload = { role: 'caretaker', ...(await caretakerDashboard(req.user.id)) };
    else if (req.user.role === 'tenant') payload = { role: 'tenant', ...(await tenantDashboard(req.user.id)) };
    else payload = { role: 'admin', ...(await adminDashboard()) };
    payload.unreadNotifications = unreadCount(req.user.id);
    res.json(payload);
  })
);

async function landlordDashboard(landlordId) {
  const stats = landlordStats(landlordId);
  const ids = landlordPropertyIds(landlordId);
  const ph = placeholders(ids);
  const params = ids.length ? ids : [-1];

  const recentPayments = ids.length
    ? all(
        `SELECT pay.id, pay.amount, pay.status, pay.receipt_number, pay.period, pay.created_at, pay.paid_at,
                t.full_name AS tenant_name, u.unit_number, p.name AS property_name
         FROM payments pay
         JOIN users t ON t.id = pay.tenant_id
         LEFT JOIN units u ON u.id = pay.unit_id
         LEFT JOIN properties p ON p.id = pay.property_id
         WHERE pay.property_id IN (${ph})
         ORDER BY pay.created_at DESC LIMIT 8`,
        params
      )
    : [];

  const recentMaintenance = ids.length
    ? all(
        `SELECT m.id, m.title, m.priority, m.status, m.created_at, p.name AS property_name, u.unit_number
         FROM maintenance_requests m
         JOIN properties p ON p.id = m.property_id
         LEFT JOIN units u ON u.id = m.unit_id
         WHERE m.property_id IN (${ph})
         ORDER BY m.created_at DESC LIMIT 6`,
        params
      )
    : [];

  const applicationStats = ids.length
    ? all(
        `SELECT a.status, COUNT(*) AS c FROM applications a JOIN properties p ON p.id = a.property_id
         WHERE p.landlord_id = ? GROUP BY a.status`,
        [landlordId]
      )
    : [];
  const applications = { pending: 0, under_review: 0, info_requested: 0, approved: 0, rejected: 0, assigned: 0 };
  applicationStats.forEach((r) => (applications[r.status] = Number(r.c)));

  const expiring = ids.length
    ? all(
        `SELECT l.id, l.end_date, l.rent, t.full_name AS tenant_name, u.unit_number, p.name AS property_name
         FROM leases l JOIN users t ON t.id = l.tenant_id JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = l.property_id
         WHERE l.status = 'active' AND l.property_id IN (${ph})
           AND date(l.end_date) <= date('now', '+45 days')
         ORDER BY l.end_date ASC LIMIT 8`,
        params
      )
    : [];

  const arrearsRows = ids.length
    ? all(
        `SELECT l.*, t.full_name AS tenant_name, u.unit_number, p.name AS property_name
         FROM leases l JOIN users t ON t.id = l.tenant_id JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = l.property_id
         WHERE l.status = 'active' AND p.landlord_id = ?`,
        [landlordId]
      )
    : [];
  const arrears = arrearsRows
    .map((l) => ({ lease_id: l.id, tenant_name: l.tenant_name, unit_number: l.unit_number, property_name: l.property_name, ...leaseArrears(l) }))
    .filter((a) => a.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const byProperty = ids.length
    ? all(
        `SELECT p.id, p.name,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS units,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id AND status = 'occupied') AS occupied,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id AND COALESCE(occupancy_known,1) = 0) AS unknown,
                (SELECT COALESCE(SUM(rent),0) FROM units WHERE property_id = p.id AND status = 'occupied') AS monthly_rent,
                (SELECT COALESCE(SUM(amount),0) FROM payments WHERE property_id = p.id AND status = 'completed'
                   AND paid_at >= strftime('%Y-%m-01')) AS collected_month,
                (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE property_id = p.id
                   AND date(expense_date) >= date('now','start of month')) AS expenses_month,
                (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE property_id = p.id) AS expenses_total
         FROM properties p WHERE p.landlord_id = ? ORDER BY p.name`,
        [landlordId]
      )
    : [];

  const recentExpenses = ids.length
    ? all(
        `SELECT e.id, e.category, e.description, e.amount, e.expense_date, p.name AS property_name, u.unit_number
         FROM expenses e
         JOIN properties p ON p.id = e.property_id
         LEFT JOIN units u ON u.id = e.unit_id
         WHERE e.property_id IN (${ph})
         ORDER BY e.expense_date DESC, e.id DESC LIMIT 6`,
        params
      )
    : [];

  const activity = ids.length
    ? all(
        `SELECT a.id, a.user_id, a.action, a.entity, a.entity_id, a.details, a.property_id, a.actor_role, a.created_at,
                u.full_name AS user_name, p.name AS property_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN properties p ON p.id = a.property_id
         WHERE a.property_id IN (${ph})
         ORDER BY a.created_at DESC LIMIT 15`,
        params
      )
    : [];

  const caretakers = all(
    `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status,
            GROUP_CONCAT(p.name, ', ') AS property_names,
            COUNT(pc.id) AS properties_assigned
     FROM property_caretakers pc
     JOIN users u ON u.id = pc.caretaker_id
     JOIN properties p ON p.id = pc.property_id
     WHERE pc.property_id IN (${ph})
     GROUP BY u.id
     ORDER BY u.full_name`,
    params
  );

  return {
    stats,
    trends: paymentTrend(ids),
    recentPayments,
    recentMaintenance,
    recentExpenses,
    applications,
    expiring,
    arrears,
    byProperty,
    activity,
    caretakers,
    unreadNotifications: unreadCount(landlordId),
  };
}

async function caretakerDashboard(caretakerId) {
  const ids = caretakerPropertyIds(caretakerId);
  const ph = placeholders(ids);
  const params = ids.length ? ids : [-1];

  const propertyRows = ids.length
    ? all(
        `SELECT p.id, p.name,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS units,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id AND status = 'occupied') AS occupied,
                (SELECT COUNT(*) FROM units WHERE property_id = p.id AND COALESCE(occupancy_known,1) = 0) AS unknown,
                (SELECT COALESCE(SUM(rent),0) FROM units WHERE property_id = p.id AND status = 'occupied') AS monthly_rent,
                (SELECT COALESCE(SUM(amount),0) FROM payments WHERE property_id = p.id AND status = 'completed'
                   AND paid_at >= strftime('%Y-%m-01')) AS collected_month,
                (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE property_id = p.id
                   AND date(expense_date) >= date('now','start of month')) AS expenses_month,
                (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE property_id = p.id) AS expenses_total
         FROM properties p WHERE p.id IN (${ph}) ORDER BY p.name`,
        params
      )
    : [];

  const expenseStats = ids.length
    ? get(
        `SELECT COALESCE(SUM(amount),0) AS total,
                COALESCE(SUM(CASE WHEN date(expense_date) >= date('now','start of month') THEN amount ELSE 0 END),0) AS month
         FROM expenses WHERE property_id IN (${ph})`,
        params
      ) || { total: 0, month: 0 }
    : { total: 0, month: 0 };

  const leaseRows = ids.length
    ? all(
        `SELECT l.*, t.full_name AS tenant_name, u.unit_number, p.name AS property_name
         FROM leases l JOIN users t ON t.id = l.tenant_id JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = l.property_id
         WHERE l.status = 'active' AND l.property_id IN (${ph})`,
        params
      )
    : [];
  const arrears = leaseRows
    .map((l) => ({ lease_id: l.id, tenant_name: l.tenant_name, unit_number: l.unit_number, property_name: l.property_name, ...leaseArrears(l) }))
    .filter((a) => a.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const arrearsTotal = leaseRows.reduce((s, l) => s + leaseArrears(l).total, 0);

  const maintenanceStats = ids.length
    ? get(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status NOT IN ('completed','closed') THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN priority = 'urgent' AND status NOT IN ('completed','closed') THEN 1 ELSE 0 END) AS urgent,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN category LIKE '%complaint%' THEN 1 ELSE 0 END) AS complaints
         FROM maintenance_requests WHERE property_id IN (${ph})`,
        params
      )
    : { total: 0, open: 0, urgent: 0, completed: 0, complaints: 0 };

  const moveOutStats = ids.length
    ? all(
        `SELECT status, COUNT(*) AS c FROM move_outs WHERE property_id IN (${ph}) GROUP BY status`,
        params
      )
    : [];
  const moveOutsInitiated = moveOutStats.find((r) => r.status === 'initiated')?.c || 0;
  const moveOutsCompleted = moveOutStats.find((r) => r.status === 'completed')?.c || 0;

  const recentPayments = ids.length
    ? all(
        `SELECT pay.id, pay.amount, pay.status, pay.receipt_number, pay.period, pay.created_at,
                t.full_name AS tenant_name, u.unit_number, p.name AS property_name
         FROM payments pay
         JOIN users t ON t.id = pay.tenant_id
         LEFT JOIN units u ON u.id = pay.unit_id
         LEFT JOIN properties p ON p.id = pay.property_id
         WHERE pay.property_id IN (${ph})
         ORDER BY pay.created_at DESC LIMIT 8`,
        params
      )
    : [];

  const recentMaintenance = ids.length
    ? all(
        `SELECT m.id, m.title, m.priority, m.status, m.created_at, m.category, p.name AS property_name, u.unit_number
         FROM maintenance_requests m
         JOIN properties p ON p.id = m.property_id
         LEFT JOIN units u ON u.id = m.unit_id
         WHERE m.property_id IN (${ph})
         ORDER BY m.created_at DESC LIMIT 6`,
        params
      )
    : [];

  const recentExpenses = ids.length
    ? all(
        `SELECT e.id, e.category, e.description, e.amount, e.expense_date, p.name AS property_name, u.unit_number
         FROM expenses e
         JOIN properties p ON p.id = e.property_id
         LEFT JOIN units u ON u.id = e.unit_id
         WHERE e.property_id IN (${ph})
         ORDER BY e.expense_date DESC, e.id DESC LIMIT 6`,
        params
      )
    : [];

  const moveOuts = ids.length
    ? all(
        `SELECT mo.id, mo.status, mo.move_out_date, mo.outstanding_rent, mo.damages_cost, mo.created_at,
                t.full_name AS tenant_name, u.unit_number, p.name AS property_name
         FROM move_outs mo
         JOIN users t ON t.id = mo.tenant_id
         JOIN units u ON u.id = mo.unit_id
         JOIN properties p ON p.id = mo.property_id
         WHERE mo.property_id IN (${ph})
         ORDER BY mo.created_at DESC LIMIT 8`,
        params
      )
    : [];

  const expiring = ids.length
    ? all(
        `SELECT l.id, l.end_date, l.rent, t.full_name AS tenant_name, u.unit_number, p.name AS property_name
         FROM leases l JOIN users t ON t.id = l.tenant_id JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = l.property_id
         WHERE l.status = 'active' AND l.property_id IN (${ph})
           AND date(l.end_date) <= date('now', '+45 days')
         ORDER BY l.end_date ASC LIMIT 8`,
        params
      )
    : [];

  const stats = {
    properties: propertyRows.length,
    units: propertyRows.reduce((s, r) => s + Number(r.units), 0),
    occupied: propertyRows.reduce((s, r) => s + Number(r.occupied), 0),
    monthlyRent: propertyRows.reduce((s, r) => s + Number(r.monthly_rent), 0),
    collectedMonth: propertyRows.reduce((s, r) => s + Number(r.collected_month), 0),
    arrearsTotal,
    maintenance_open: Number(maintenanceStats.open || 0),
    maintenance_total: Number(maintenanceStats.total || 0),
    complaints: Number(maintenanceStats.complaints || 0),
    move_outs_initiated: Number(moveOutsInitiated),
    move_outs_completed: Number(moveOutsCompleted),
    expensesTotal: Number(expenseStats.total || 0),
    expensesMonth: Number(expenseStats.month || 0),
  };

  return {
    stats,
    trends: paymentTrend(ids),
    recentPayments,
    recentMaintenance,
    recentExpenses,
    moveOuts,
    arrears,
    expiring,
    byProperty: propertyRows,
    unreadNotifications: unreadCount(caretakerId),
  };
}

async function tenantDashboard(tenantId) {
  const stats = tenantStats(tenantId);
  const lease = stats.lease;
  const payments = all('SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 6', [tenantId]);
  const maintenance = all(
    'SELECT id, title, status, priority, created_at FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 5',
    [tenantId]
  );
  const maintenanceStats = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status NOT IN ('completed','closed') THEN 1 ELSE 0 END) AS open
     FROM maintenance_requests WHERE tenant_id = ?`,
    [tenantId]
  );
  const announcements = lease
    ? all(
        `SELECT a.* FROM announcements a WHERE a.property_id = ? ORDER BY a.created_at DESC LIMIT 4`,
        [lease.property_id]
      )
    : [];
  const applications = all('SELECT * FROM applications WHERE applicant_id = ? ORDER BY created_at DESC', [tenantId]);

  return {
    stats: {
      ...stats,
      maintenance_open: Number(maintenanceStats.open || 0),
      maintenance_total: Number(maintenanceStats.total || 0),
      applications: applications.length,
      applications_pending: applications.filter((a) => ['pending', 'under_review', 'info_requested'].includes(a.status)).length,
    },
    payments,
    maintenance,
    announcements,
    applications,
    unreadNotifications: unreadCount(tenantId),
  };
}

async function adminDashboard() {
  const users = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN role='landlord' THEN 1 ELSE 0 END) AS landlords,
            SUM(CASE WHEN role='tenant' THEN 1 ELSE 0 END) AS tenants,
            SUM(CASE WHEN role='admin' THEN 1 ELSE 0 END) AS admins,
            SUM(CASE WHEN role='caretaker' THEN 1 ELSE 0 END) AS caretakers,
            SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END) AS suspended
     FROM users`
  );
  const properties = get(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM properties`);
  const units = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='occupied' THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN status='vacant' AND occupancy_known=1 THEN 1 ELSE 0 END) AS vacant,
            SUM(CASE WHEN COALESCE(occupancy_known,1)=0 THEN 1 ELSE 0 END) AS unknown
     FROM units`
  );
  const payments = get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status='completed' THEN amount END),0) AS collected,
            COALESCE(SUM(CASE WHEN status IN ('pending','processing') THEN amount END),0) AS pending,
            COALESCE(SUM(CASE WHEN status='failed' THEN amount END),0) AS failed
     FROM payments`
  );
  const applications = get('SELECT COUNT(*) AS total, SUM(CASE WHEN status = \'pending\' THEN 1 ELSE 0 END) AS pending FROM applications');
  const maintenance = get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status NOT IN ('completed','closed') THEN 1 ELSE 0 END) AS open FROM maintenance_requests`
  );
  const leases = get(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM leases`);

  const allIds = all('SELECT id FROM properties').map((p) => p.id);
  const recentAudit = all(
    `SELECT a.*, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT 12`
  );
  const recentPayments = all(
    `SELECT pay.id, pay.amount, pay.status, pay.receipt_number, pay.created_at, t.full_name AS tenant_name,
            p.name AS property_name, u.unit_number
     FROM payments pay JOIN users t ON t.id = pay.tenant_id
     LEFT JOIN properties p ON p.id = pay.property_id LEFT JOIN units u ON u.id = pay.unit_id
     ORDER BY pay.created_at DESC LIMIT 8`
  );
  const topCounties = all(
    `SELECT county, COUNT(*) AS properties FROM properties GROUP BY county ORDER BY properties DESC LIMIT 8`
  );

  return {
    stats: {
      users: Number(users.total || 0),
      landlords: Number(users.landlords || 0),
      tenants: Number(users.tenants || 0),
      caretakers: Number(users.caretakers || 0),
      suspended: Number(users.suspended || 0),
      properties: Number(properties.total || 0),
      activeProperties: Number(properties.active || 0),
      units: Number(units.total || 0),
      occupied: Number(units.occupied || 0),
      vacant: Number(units.vacant || 0),
      unknownUnits: Number(units.unknown || 0),
      collected: Number(payments.collected || 0),
      pendingPayments: Number(payments.pending || 0),
      paymentCount: Number(payments.total || 0),
      applications: Number(applications.total || 0),
      pendingApplications: Number(applications.pending || 0),
      maintenanceOpen: Number(maintenance.open || 0),
      activeLeases: Number(leases.active || 0),
    },
    trends: paymentTrend(allIds, 6),
    recentAudit,
    recentPayments,
    topCounties,
  };
}

export default router;
