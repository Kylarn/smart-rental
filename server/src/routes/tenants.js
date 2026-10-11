import express from 'express';
import bcrypt from 'bcryptjs';
import { all, get, insert, run, tx } from '../db/index.js';
import { asyncHandler, notFound, forbidden, badRequest, conflict, validate, normalizePhone } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { leaseArrears, activeLeaseOfUnit, isCaretakerOfProperty, landlordPropertyIds, caretakerPropertyIds, placeholders } from '../services/rent.js';

const router = express.Router();
router.use(requireAuth);

const okDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function scopePropertyIds(user) {
  if (user.role === 'admin') return all('SELECT id FROM properties').map((r) => r.id);
  if (user.role === 'landlord') return landlordPropertyIds(user.id);
  if (user.role === 'caretaker') return caretakerPropertyIds(user.id);
  return [];
}

function serializeLeaseSummary(l) {
  const arrears = leaseArrears(l);
  const daysToExpiry = Math.ceil((new Date(l.end_date) - Date.now()) / 86400000);
  return {
    ...l,
    arrears: arrears.total,
    arrears_months: arrears.months,
    unpaid_periods: arrears.unpaidPeriods,
    days_to_expiry: daysToExpiry,
    lease_status: l.status !== 'active' ? l.status : daysToExpiry < 0 ? 'expired' : daysToExpiry <= 30 ? 'expiring' : 'active',
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = [];
    const where = [];
    let sql = `
      SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status, u.created_at,
             l.id AS lease_id, l.property_id, l.unit_id, l.start_date, l.end_date, l.rent, l.deposit, l.frequency, l.status AS lease_status,
             p.name AS property_name, un.unit_number, un.unit_type
      FROM leases l
      JOIN users u ON u.id = l.tenant_id
      JOIN properties p ON p.id = l.property_id
      JOIN units un ON un.id = l.unit_id`;
    if (req.user.role === 'landlord') {
      where.push('p.landlord_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where.push('p.id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)');
      params.push(req.user.id);
    } else if (req.user.role === 'tenant') {
      where.push('u.id = ?');
      params.push(req.user.id);
    }
    const status = req.query.status;
    if (status === 'active') where.push("l.status = 'active'");
    if (status === 'former') where.push("l.status != 'active'");
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY l.created_at DESC';
    const rows = all(sql, params);
    const scopeProps = scopePropertyIds(req.user);
    const ph = placeholders(scopeProps);
    const grouped = new Map();
    rows.forEach((r) => {
      const existing = grouped.get(r.id);
      if (!existing || (existing.lease_status !== 'active' && r.lease_status === 'active')) grouped.set(r.id, r);
    });
    const tenants = [...grouped.values()].map((t) => {
      const leaseRow = get('SELECT * FROM leases WHERE id = ?', [t.lease_id]);
      const payments = all(
        `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE tenant_id = ? AND status = 'completed'${
          scopeProps.length ? ` AND property_id IN (${ph})` : ''
        }`,
        scopeProps.length ? [t.id, ...scopeProps] : [t.id]
      );
      return {
        id: t.id,
        full_name: t.full_name,
        email: t.email,
        phone: t.phone,
        avatar_url: t.avatar_url,
        status: t.status,
        joined: t.created_at,
        total_paid: Number(payments[0]?.total || 0),
        property_id: t.property_id,
        property_name: t.property_name,
        unit_id: t.unit_id,
        unit_number: t.unit_number,
        unit_type: t.unit_type,
        lease: serializeLeaseSummary({ ...leaseRow, property_name: t.property_name, unit_number: t.unit_number, unit_type: t.unit_type }),
      };
    });
    res.json({ tenants });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const tenant = get('SELECT id, role, full_name, email, phone, avatar_url, status, county, id_number, bio, created_at FROM users WHERE id = ?', [id]);
    if (!tenant || tenant.role !== 'tenant') throw notFound('Tenant not found');
    if (req.user.role === 'tenant' && id !== req.user.id) throw notFound('Tenant not found');
    if (req.user.role === 'landlord') {
      const owned = get(
        'SELECT COUNT(*) AS c FROM leases l JOIN properties p ON p.id = l.property_id WHERE l.tenant_id = ? AND p.landlord_id = ?',
        [id, req.user.id]
      ).c;
      if (!owned) throw notFound('Tenant not found');
    }
    if (req.user.role === 'caretaker') {
      const assigned = get(
        `SELECT COUNT(*) AS c FROM leases l
         WHERE l.tenant_id = ? AND l.property_id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)`,
        [id, req.user.id]
      ).c;
      if (!assigned) throw notFound('Tenant not found');
    }
    const scopeProps = scopePropertyIds(req.user);
    const ph = placeholders(scopeProps);
    const scopeClause = scopeProps.length ? ` AND property_id IN (${ph})` : '';
    const leases = all(
      `SELECT l.*, p.name AS property_name, u.unit_number, u.unit_type FROM leases l
       JOIN properties p ON p.id = l.property_id JOIN units u ON u.id = l.unit_id
       WHERE l.tenant_id = ?${scopeProps.length ? ` AND l.property_id IN (${ph})` : ''} ORDER BY l.created_at DESC`,
      scopeProps.length ? [id, ...scopeProps] : [id]
    ).map(serializeLeaseSummary);
    const payments = all(`SELECT * FROM payments WHERE tenant_id = ?${scopeClause} ORDER BY created_at DESC LIMIT 100`, scopeProps.length ? [id, ...scopeProps] : [id]);
    const maintenance = all(`SELECT * FROM maintenance_requests WHERE tenant_id = ?${scopeClause} ORDER BY created_at DESC LIMIT 50`, scopeProps.length ? [id, ...scopeProps] : [id]);
    const totalPaid = get(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE tenant_id = ? AND status = 'completed'${scopeClause}`, scopeProps.length ? [id, ...scopeProps] : [id]).total;
    const activeLease = leases.find((l) => l.lease_status === 'active') || null;
    res.json({
      tenant,
      leases,
      payments,
      maintenance,
      total_paid: Number(totalPaid),
      arrears: activeLease ? leaseArrears(activeLease) : { total: 0, unpaidPeriods: [], months: 0 },
    });
  })
);

router.post(
  '/',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    validate(req.body, {
      full_name: { required: true, label: 'Tenant name', minLength: 3 },
      email: { required: true, label: 'Email', type: 'email' },
      phone: { required: true, label: 'Phone', type: 'phone' },
      unit_id: { required: true, label: 'Unit', type: 'number' },
      start_date: { required: true, label: 'Lease start date' },
      end_date: { required: true, label: 'Lease end date' },
    });
    const unit = get(
      `SELECT u.*, p.landlord_id, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`,
      [Number(req.body.unit_id)]
    );
    if (!unit) throw notFound('Unit not found');
    if (req.user.role === 'landlord' && unit.landlord_id !== req.user.id) throw notFound('Unit not found');
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, unit.property_id)) throw forbidden('This unit is not on a property you manage');
    if (unit.status === 'occupied' || activeLeaseOfUnit(unit.id)) {
      throw badRequest('This unit is already occupied', { unit_id: 'Unit is occupied' });
    }
    if (!okDate(req.body.start_date) || !okDate(req.body.end_date)) {
      throw badRequest('Lease dates must be valid YYYY-MM-DD dates', { end_date: 'Invalid date' });
    }
    if (req.body.end_date <= req.body.start_date) {
      throw badRequest('Lease end date must be after the start date', { end_date: 'Invalid date range' });
    }

    const email = String(req.body.email).trim().toLowerCase();
    const tenantUser = get('SELECT * FROM users WHERE email = ?', [email]);
    if (tenantUser && tenantUser.role !== 'tenant') throw conflict('This email belongs to a non-tenant account');
    if (tenantUser && tenantUser.status === 'suspended') throw conflict('This tenant account is suspended');

    const password = req.body.password ? String(req.body.password) : `SR-${Math.random().toString(36).slice(2, 10)}`;
    const passwordHash = tenantUser ? null : await bcrypt.hash(password, 10);
    const rent = req.body.rent === undefined || req.body.rent === '' ? Number(unit.rent) : Number(req.body.rent);
    if (!Number.isFinite(rent) || rent <= 0) throw badRequest('Please enter a valid rent amount', { rent: 'Must be a positive number' });
    const deposit =
      req.body.deposit === undefined || req.body.deposit === '' ? Number(unit.deposit || 0) : Number(req.body.deposit);
    if (!Number.isFinite(deposit) || deposit < 0) throw badRequest('Please enter a valid deposit amount', { deposit: 'Must be zero or more' });
    const FREQ = ['monthly', 'quarterly', 'semi-annually', 'annually'];
    const frequency = req.body.frequency || 'monthly';
    if (!FREQ.includes(frequency)) throw badRequest('Invalid rent frequency', { frequency: `One of: ${FREQ.join(', ')}` });

    const { tenantId, leaseId } = tx(() => {
      let tenantId = tenantUser?.id;
      if (tenantId) {
        run('UPDATE users SET phone = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [
          normalizePhone(req.body.phone),
          tenantId,
        ]);
      } else {
        tenantId = insert(
          `INSERT INTO users (role, full_name, email, phone, password_hash, county) VALUES ('tenant', ?, ?, ?, ?, ?)`,
          [String(req.body.full_name).trim(), email, normalizePhone(req.body.phone), passwordHash, req.body.county || null]
        );
        notify(tenantId, {
          type: 'info',
          title: 'Welcome to Smart Rentals',
          body: `Your tenant account has been created for ${unit.property_name}, Unit ${unit.unit_number}.`,
          link: '/tenant',
        });
      }

      const leaseId = insert(
        `INSERT INTO leases (property_id, unit_id, tenant_id, start_date, end_date, rent, deposit, frequency, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          unit.property_id,
          unit.id,
          tenantId,
          req.body.start_date,
          req.body.end_date,
          rent,
          deposit,
          frequency,
          req.body.notes || '',
        ]
      );
      run("UPDATE units SET status = 'occupied', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [unit.id]);
      notify(tenantId, {
        type: 'lease',
        title: 'Lease created',
        body: `Your lease for ${unit.property_name}, Unit ${unit.unit_number} runs from ${req.body.start_date} to ${req.body.end_date}.`,
        link: '/tenant/lease',
        dedupeKey: `lease-${leaseId}`,
      });
      return { tenantId, leaseId };
    });

    audit(req, 'tenant.added', 'tenant', tenantId, { unit_id: unit.id, lease_id: leaseId }, { property_id: unit.property_id });
    audit(req, 'lease.created', 'lease', leaseId, { unit_id: unit.id, tenant_id: tenantId }, { property_id: unit.property_id });
    notify(unit.landlord_id, {
      type: 'tenant',
      title: `${tenantUser ? 'Move-in' : 'New tenant registered'}: ${req.body.full_name}`,
      body: `${req.body.full_name} (Unit ${unit.unit_number}, ${unit.property_name}).`,
      link: '/landlord/tenants',
      dedupeKey: req.body.start_date ? `movein-${tenantId}-${req.body.start_date}` : `tenant-new-${tenantId}`,
    });
    res.status(201).json({ ok: true, tenant_id: tenantId, lease_id: leaseId });
  })
);

function assertLandlord(propertyLandlordId, userId) {
  if (propertyLandlordId !== userId) throw notFound('Property not found');
}

router.put(
  '/:id',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const tenant = get('SELECT * FROM users WHERE id = ? AND role = ?', [id, 'tenant']);
    if (!tenant) throw notFound('Tenant not found');
    if (req.user.role === 'landlord') {
      const owned = get(
        'SELECT COUNT(*) AS c FROM leases l JOIN properties p ON p.id = l.property_id WHERE l.tenant_id = ? AND p.landlord_id = ?',
        [id, req.user.id]
      ).c;
      if (!owned) throw notFound('Tenant not found');
    }
    if (req.user.role === 'caretaker') {
      const assigned = get(
        `SELECT COUNT(*) AS c FROM leases l
         WHERE l.tenant_id = ? AND l.property_id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)`,
        [id, req.user.id]
      ).c;
      if (!assigned) throw notFound('Tenant not found');
    }
    const updates = {};
    if (req.body.full_name) updates.full_name = String(req.body.full_name).trim();
    if (req.body.phone !== undefined) {
      const phone = normalizePhone(req.body.phone);
      if (!phone) throw badRequest('Invalid phone number', { phone: 'Use format 0712345678' });
      updates.phone = phone;
    }
    if (req.body.county !== undefined) updates.county = req.body.county;
    if (req.body.id_number !== undefined) updates.id_number = req.body.id_number;
    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [...keys.map((k) => updates[k]), id]
      );
      audit(req, 'tenant.updated', 'tenant', id, { fields: keys });
    }
    res.json({ ok: true });
  })
);

export default router;
