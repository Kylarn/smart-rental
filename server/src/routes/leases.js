import express from 'express';
import bcrypt from 'bcryptjs';
import { all, get, insert, run, tx } from '../db/index.js';
import { asyncHandler, notFound, badRequest, forbidden, conflict, validate, normalizePhone, parseJson, formatDate } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { leaseArrears, leaseCoverage, activeLeaseOfUnit, isCaretakerOfProperty } from '../services/rent.js';
import { upload, fileUrl } from '../middleware/upload.js';

const router = express.Router();
router.use(requireAuth);

const RENT_FREQUENCIES = ['monthly', 'quarterly', 'semi-annually', 'annually'];
const okDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function serializeLease(l) {
  const cov = leaseCoverage(l);
  const daysToExpiry = Math.ceil((new Date(l.end_date) - Date.now()) / 86400000);
  return {
    ...l,
    arrears: cov.total,
    arrears_months: cov.months,
    unpaid_periods: cov.unpaidPeriods,
    credit: cov.credit,
    coverage: cov.coverage.map((c) => ({ period: c.period, paid: c.status === 'paid', partial: c.status === 'partial' })),
    days_to_expiry: daysToExpiry,
    lease_status: l.status !== 'active' ? l.status : daysToExpiry < 0 ? 'expired' : daysToExpiry <= 30 ? 'expiring' : 'active',
  };
}

const SELECT_LEASE = `
  SELECT l.*, p.name AS property_name, p.landlord_id, p.county, p.area,
         u.unit_number, u.unit_type, u.floor, u.status AS unit_status,
         t.full_name AS tenant_name, t.email AS tenant_email, t.phone AS tenant_phone, t.avatar_url AS tenant_avatar,
         lo.full_name AS landlord_name
  FROM leases l
  JOIN properties p ON p.id = l.property_id
  JOIN units u ON u.id = l.unit_id
  JOIN users t ON t.id = l.tenant_id
  JOIN users lo ON lo.id = p.landlord_id`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = [];
    const where = [];
    if (req.user.role === 'landlord') {
      where.push('p.landlord_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where.push('p.id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)');
      params.push(req.user.id);
    } else if (req.user.role === 'tenant') {
      where.push('l.tenant_id = ?');
      params.push(req.user.id);
    }
    if (req.query.status) {
      where.push('l.status = ?');
      params.push(req.query.status);
    }
    if (req.query.property_id) {
      where.push('l.property_id = ?');
      params.push(Number(req.query.property_id));
    }
    let sql = SELECT_LEASE;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY l.created_at DESC';
    const rows = all(sql, params);
    res.json({ leases: rows.map(serializeLease) });
  })
);

router.get(
  '/move-outs',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    if (req.user.role === 'landlord') {
      where.push('mo.property_id IN (SELECT id FROM properties WHERE landlord_id = ?)');
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where.push('mo.property_id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)');
      params.push(req.user.id);
    } else if (req.user.role === 'tenant') {
      throw forbidden();
    } else if (req.query.property_id) {
      where.push('mo.property_id = ?');
      params.push(Number(req.query.property_id));
    }
    if (req.query.status) {
      where.push('mo.status = ?');
      params.push(req.query.status);
    }
    let sql = `
      SELECT mo.*, p.name AS property_name, u.unit_number,
             t.full_name AS tenant_name, t.email AS tenant_email, t.phone AS tenant_phone,
             l.rent AS lease_rent, l.deposit AS lease_deposit, l.status AS lease_status
      FROM move_outs mo
      JOIN properties p ON p.id = mo.property_id
      JOIN units u ON u.id = mo.unit_id
      JOIN users t ON t.id = mo.tenant_id
      JOIN leases l ON l.id = mo.lease_id`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY mo.created_at DESC LIMIT 300';
    const rows = all(sql, params).map((m) => ({ ...m, damages: parseJson(m.damages, []) }));
    res.json({ move_outs: rows });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lease = get(`${SELECT_LEASE} WHERE l.id = ?`, [Number(req.params.id)]);
    if (!lease) throw notFound('Lease not found');
    if (req.user.role === 'landlord' && lease.landlord_id !== req.user.id) throw notFound('Lease not found');
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, lease.property_id)) throw notFound('Lease not found');
    if (req.user.role === 'tenant' && lease.tenant_id !== req.user.id) throw forbidden();
    const payments = all('SELECT * FROM payments WHERE lease_id = ? ORDER BY created_at DESC', [lease.id]);
    res.json({ lease: serializeLease(lease), payments });
  })
);

router.post(
  '/',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    validate(req.body, {
      unit_id: { required: true, label: 'Unit', type: 'number' },
      start_date: { required: true, label: 'Start date' },
      end_date: { required: true, label: 'End date' },
    });
    const unit = get(
      `SELECT u.*, p.landlord_id, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`,
      [Number(req.body.unit_id)]
    );
    if (!unit) throw notFound('Unit not found');
    if (req.user.role === 'landlord' && unit.landlord_id !== req.user.id) throw notFound('Unit not found');
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, unit.property_id)) throw forbidden('This unit is not on a property you manage');
    if (activeLeaseOfUnit(unit.id)) throw badRequest('This unit already has an active lease', { unit_id: 'Occupied' });
    if (!okDate(req.body.start_date) || !okDate(req.body.end_date)) {
      throw badRequest('Start and end dates must be valid YYYY-MM-DD dates', { start_date: 'Invalid date' });
    }
    if (req.body.end_date <= req.body.start_date) {
      throw badRequest('End date must be after start date', { end_date: 'Invalid date range' });
    }

    const rent =
      req.body.rent === undefined || req.body.rent === '' ? Number(unit.rent) : Number(req.body.rent);
    if (!Number.isFinite(rent) || rent <= 0) {
      throw badRequest('Please enter a valid rent amount', { rent: 'Must be a positive number' });
    }
    const deposit =
      req.body.deposit === undefined || req.body.deposit === '' ? Number(unit.deposit || 0) : Number(req.body.deposit);
    if (!Number.isFinite(deposit) || deposit < 0) {
      throw badRequest('Please enter a valid deposit amount', { deposit: 'Must be zero or more' });
    }
    const frequency = req.body.frequency || 'monthly';
    if (!RENT_FREQUENCIES.includes(frequency)) throw badRequest('Invalid rent frequency', { frequency: `One of: ${RENT_FREQUENCIES.join(', ')}` });

    let tenantId = req.body.tenant_id ? Number(req.body.tenant_id) : null;
    if (!tenantId) {
      validate(req.body, {
        tenant_name: { required: true, label: 'Tenant name', minLength: 3 },
        tenant_email: { required: true, label: 'Tenant email', type: 'email' },
        tenant_phone: { required: true, label: 'Tenant phone', type: 'phone' },
      });
      const email = String(req.body.tenant_email).trim().toLowerCase();
      const existing = get('SELECT id, role, status FROM users WHERE email = ?', [email]);
      if (existing) {
        if (existing.role !== 'tenant') throw conflict('This email belongs to a non-tenant account', { tenant_email: 'Use a different email for this tenant' });
        if (existing.status === 'suspended') throw conflict('This tenant account is suspended', { tenant_email: 'Suspended account' });
        tenantId = existing.id;
      } else {
        const password = req.body.tenant_password ? String(req.body.tenant_password) : `SR-${Math.random().toString(36).slice(2, 10)}`;
        const hash = await bcrypt.hash(password, 10);
        tenantId = insert(
          `INSERT INTO users (role, full_name, email, phone, password_hash, county) VALUES ('tenant', ?, ?, ?, ?, ?)`,
          [String(req.body.tenant_name).trim(), email, normalizePhone(req.body.tenant_phone), hash, null]
        );
      }
    }

    const leaseId = insert(
      `INSERT INTO leases (property_id, unit_id, tenant_id, start_date, end_date, rent, deposit, frequency, notes, document_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        null,
      ]
    );
    run("UPDATE units SET status = 'occupied', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [unit.id]);
    notify(tenantId, {
      type: 'lease',
      title: 'New lease created',
      body: `Unit ${unit.unit_number} at ${unit.property_name} is yours from ${formatDate(req.body.start_date)}.`,
      link: '/tenant/lease',
      dedupeKey: `lease-${leaseId}`,
    });
    audit(req, 'lease.created', 'lease', leaseId, { unit_id: unit.id, tenant_id: tenantId }, { property_id: unit.property_id });
    notify(unit.landlord_id, {
      type: 'lease',
      title: 'Move-in completed',
      body: `${String(req.body.tenant_name || '').trim() || 'A tenant'} moved into Unit ${unit.unit_number} at ${unit.property_name}.`,
      link: '/landlord/leases',
      dedupeKey: `lease-created-${leaseId}`,
    });
    res.status(201).json({ lease_id: leaseId, tenant_id: tenantId });
  })
);

router.put(
  '/:id',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    const lease = get(`${SELECT_LEASE} WHERE l.id = ?`, [Number(req.params.id)]);
    if (!lease) throw notFound('Lease not found');
    if (req.user.role === 'landlord' && lease.landlord_id !== req.user.id) throw notFound('Lease not found');
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, lease.property_id)) throw notFound('Lease not found');

    const updates = {};
    ['start_date', 'end_date', 'rent', 'deposit', 'frequency', 'notes'].forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    if (updates.start_date && okDate(updates.start_date) && updates.end_date && okDate(updates.end_date) && updates.end_date <= updates.start_date) {
      throw badRequest('End date must be after start date', { end_date: 'Invalid date range' });
    }
    if (updates.rent !== undefined) {
      const rent = Number(updates.rent);
      if (!Number.isFinite(rent) || rent <= 0) throw badRequest('Please enter a valid rent amount', { rent: 'Must be a positive number' });
      updates.rent = rent;
    }
    if (updates.deposit !== undefined) {
      const deposit = Number(updates.deposit);
      if (!Number.isFinite(deposit) || deposit < 0) throw badRequest('Please enter a valid deposit amount', { deposit: 'Must be zero or more' });
      updates.deposit = deposit;
    }
    if (updates.frequency !== undefined && !RENT_FREQUENCIES.includes(updates.frequency)) {
      throw badRequest('Invalid rent frequency', { frequency: `One of: ${RENT_FREQUENCIES.join(', ')}` });
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        `UPDATE leases SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [...keys.map((k) => updates[k]), lease.id]
      );
      audit(req, 'lease.updated', 'lease', lease.id, { fields: keys }, { property_id: lease.property_id });
    }
    res.json({ lease: serializeLease(get(`${SELECT_LEASE} WHERE l.id = ?`, [lease.id])) });
  })
);

router.post(
  '/:id/document',
  requireRole('landlord', 'admin'),
  upload.single('document'),
  asyncHandler(async (req, res) => {
    const lease = get(`${SELECT_LEASE} WHERE l.id = ?`, [Number(req.params.id)]);
    if (!lease) throw notFound('Lease not found');
    if (req.user.role === 'landlord' && lease.landlord_id !== req.user.id) throw notFound('Lease not found');
    if (!req.file) throw badRequest('No document uploaded');
    run('UPDATE leases SET document_url = ? WHERE id = ?', [fileUrl(req.file.filename), lease.id]);
    notify(lease.tenant_id, {
      type: 'lease',
      title: 'Lease document uploaded',
      body: `A signed agreement for Unit ${lease.unit_number} is now available.`,
      link: '/tenant/lease',
    });
    audit(req, 'lease.document_uploaded', 'lease', lease.id);
    res.json({ document_url: fileUrl(req.file.filename) });
  })
);

router.post(
  '/:id/terminate',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const lease = get(`${SELECT_LEASE} WHERE l.id = ?`, [Number(req.params.id)]);
    if (!lease) throw notFound('Lease not found');
    if (req.user.role === 'landlord' && lease.landlord_id !== req.user.id) throw notFound('Lease not found');
    if (lease.status !== 'active') throw badRequest('Only active leases can be terminated');
    const today = new Date().toISOString().slice(0, 10);
    const terminateDate = req.body.terminate_date || today;
    if (!okDate(terminateDate) || terminateDate > today) {
      throw badRequest('Termination date must be today or earlier', { terminate_date: 'Invalid date' });
    }
    const inProgress = get("SELECT id FROM move_outs WHERE lease_id = ? AND status = 'initiated'", [lease.id]);
    if (inProgress) {
      throw badRequest('A move-out is in progress for this lease. Complete or remove it before terminating.', {});
    }
    const { leaseId } = tx(() => {
      run(`UPDATE leases SET status = 'terminated', end_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [
        terminateDate,
        lease.id,
      ]);
      run("UPDATE units SET status = 'vacant', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [lease.unit_id]);
      return { leaseId: lease.id };
    });
    notify(lease.tenant_id, {
      type: 'lease',
      title: 'Lease terminated',
      body: `Your lease for Unit ${lease.unit_number} has been terminated effective ${terminateDate}.`,
      link: '/tenant/lease',
    });
    audit(req, 'lease.terminated', 'lease', leaseId, { terminate_date: terminateDate }, { property_id: lease.property_id });
    res.json({ ok: true });
  })
);

const MOVE_OUT_ACCESS = ['landlord', 'admin', 'caretaker'];

function canManageLease(req, lease) {
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'landlord') return lease.landlord_id === req.user.id;
  if (req.user.role === 'caretaker') return isCaretakerOfProperty(req.user.id, lease.property_id);
  return false;
}

function toMoveOut(lease, mo) {
  if (!mo) return null;
  const ar = leaseArrears(lease);
  return {
    ...mo,
    damages: parseJson(mo.damages, []),
    current_outstanding_rent: ar.total,
    lease: {
      id: lease.id,
      property_name: lease.property_name,
      unit_number: lease.unit_number,
      tenant_name: lease.tenant_name,
      rent: lease.rent,
      deposit: lease.deposit,
      start_date: lease.start_date,
      end_date: lease.end_date,
      status: lease.status,
    },
  };
}

const REFUND_STATUSES = ['pending', 'refunded', 'partial', 'forfeited', 'not_applicable'];

function buildMoveOutPayload(lease, body) {
  const arrears = leaseArrears(lease);
  const damages = Array.isArray(body.damages)
    ? body.damages.filter((d) => d && (d.description || d.cost))
    : [];
  const damagesCost =
    body.damages_cost !== undefined && body.damages_cost !== ''
      ? Number(body.damages_cost)
      : damages.reduce((s, d) => s + Number(d.cost || 0), 0);
  const depositHeld = body.deposit_held !== undefined && body.deposit_held !== '' ? Number(body.deposit_held) : Number(lease.deposit || 0);
  const depositRefund = body.deposit_refund !== undefined && body.deposit_refund !== '' ? Number(body.deposit_refund) : 0;
  const refundStatus = body.refund_status || 'pending';
  if (!REFUND_STATUSES.includes(refundStatus)) throw badRequest('Invalid refund status');
  if (depositRefund < 0 || damagesCost < 0 || depositHeld < 0) throw badRequest('Negative amounts are not allowed');
  const moveOutDate = body.move_out_date || new Date().toISOString().slice(0, 10);
  if (moveOutDate > new Date().toISOString().slice(0, 10)) throw badRequest('Move-out date cannot be in the future');
  return {
    move_out_date: moveOutDate,
    reason: body.reason || null,
    inspection_notes: body.inspection_notes || null,
    inspection_findings:
      typeof body.inspection_findings === 'string'
        ? body.inspection_findings
        : body.inspection_findings
          ? JSON.stringify(body.inspection_findings)
          : null,
    damages: JSON.stringify(damages),
    damages_cost: damagesCost,
    outstanding_rent: arrears.total,
    deposit_held: depositHeld,
    deposit_refund: depositRefund,
    refund_status: refundStatus,
    meter_water: body.meter_water || null,
    meter_electricity: body.meter_electricity || null,
    keys_returned: body.keys_returned ? 1 : 0,
    keys_notes: body.keys_notes || null,
    notes: body.notes || null,
  };
}

function validateSettlement(s) {
  if (!REFUND_STATUSES.includes(s.refund_status)) throw badRequest('Invalid refund status');
  if (s.deposit_refund < 0 || s.damages_cost < 0 || s.deposit_held < 0) throw badRequest('Negative amounts are not allowed');
  if (s.move_out_date > new Date().toISOString().slice(0, 10)) throw badRequest('Move-out date cannot be in the future');
  if (!s.keys_returned) throw badRequest('Keys must be returned before the unit can be released');
}

router.get(
  '/:id/move-out',
  requireRole(...MOVE_OUT_ACCESS),
  asyncHandler(async (req, res) => {
    const lease = get(`${SELECT_LEASE} WHERE l.id = ?`, [Number(req.params.id)]);
    if (!lease || !canManageLease(req, lease)) throw notFound('Lease not found');
    const mo = get('SELECT * FROM move_outs WHERE lease_id = ?', [lease.id]);
    res.json({ move_out: toMoveOut(lease, mo) });
  })
);

router.post(
  '/:id/move-out',
  requireRole(...MOVE_OUT_ACCESS),
  asyncHandler(async (req, res) => {
    const lease = get(`${SELECT_LEASE} WHERE l.id = ?`, [Number(req.params.id)]);
    if (!lease || !canManageLease(req, lease)) throw notFound('Lease not found');
    if (lease.status !== 'active') throw badRequest('Only active leases can have a move-out');
    const existing = get('SELECT * FROM move_outs WHERE lease_id = ?', [lease.id]);
    if (existing && existing.status === 'completed') throw badRequest('This move-out has already been completed');

    const payload = buildMoveOutPayload(lease, req.body);
    let id;
    if (existing) {
      run(
        `UPDATE move_outs SET move_out_date = ?, reason = ?, inspection_notes = ?, inspection_findings = ?,
           damages = ?, damages_cost = ?, outstanding_rent = ?, deposit_held = ?, deposit_refund = ?,
           refund_status = ?, meter_water = ?, meter_electricity = ?, keys_returned = ?, keys_notes = ?, notes = ?,
           initiated_by = ?, status = 'initiated', completed_at = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [
          payload.move_out_date, payload.reason, payload.inspection_notes, payload.inspection_findings,
          payload.damages, payload.damages_cost, payload.outstanding_rent, payload.deposit_held, payload.deposit_refund,
          payload.refund_status, payload.meter_water, payload.meter_electricity, payload.keys_returned, payload.keys_notes, payload.notes,
          req.user.id, existing.id,
        ]
      );
      id = existing.id;
    } else {
      id = insert(
        `INSERT INTO move_outs (lease_id, property_id, unit_id, tenant_id, initiated_by, move_out_date, reason,
           inspection_notes, inspection_findings, damages, damages_cost, outstanding_rent, deposit_held, deposit_refund,
           refund_status, meter_water, meter_electricity, keys_returned, keys_notes, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          lease.id, lease.property_id, lease.unit_id, lease.tenant_id, req.user.id, payload.move_out_date, payload.reason,
          payload.inspection_notes, payload.inspection_findings, payload.damages, payload.damages_cost, payload.outstanding_rent,
          payload.deposit_held, payload.deposit_refund, payload.refund_status, payload.meter_water, payload.meter_electricity,
          payload.keys_returned, payload.keys_notes, payload.notes,
        ]
      );
    }

    audit(req, 'moveout.initiated', 'move_out', id, { move_out_date: payload.move_out_date }, { property_id: lease.property_id });
    notify(lease.landlord_id, {
      type: 'moveout',
      title: 'Move-out initiated',
      body: `${lease.tenant_name} (Unit ${lease.unit_number}, ${lease.property_name}) is moving out. Arrears: KES ${payload.outstanding_rent.toLocaleString('en-KE')}.`,
      link: '/landlord/moveouts',
      dedupeKey: `moveout-init-${id}`,
    });
    notify(lease.tenant_id, {
      type: 'moveout',
      title: 'Move-out started',
      body: `A move-out has been initiated for Unit ${lease.unit_number}. The inspection and final settlement will be prepared shortly.`,
      link: '/tenant/lease',
      dedupeKey: `moveout-tenant-${id}`,
    });

    const mo = get('SELECT * FROM move_outs WHERE id = ?', [id]);
    res.status(201).json({ move_out: toMoveOut(lease, mo) });
  })
);

router.post(
  '/:id/move-out/complete',
  requireRole(...MOVE_OUT_ACCESS),
  asyncHandler(async (req, res) => {
    const lease = get(`${SELECT_LEASE} WHERE l.id = ?`, [Number(req.params.id)]);
    if (!lease || !canManageLease(req, lease)) throw notFound('Lease not found');
    if (lease.status !== 'active') throw badRequest('Only active leases can be moved out');

    const { moveOut, leaseOut, unitOut } = tx(() => {
      const record = get('SELECT * FROM move_outs WHERE lease_id = ?', [lease.id]);
      if (record && record.status === 'completed') {
        throw badRequest('This move-out has already been completed');
      }

      let payload = null;
      let recordId = record?.id;
      if (!record) {
        payload = buildMoveOutPayload(lease, req.body);
        recordId = insert(
          `INSERT INTO move_outs (lease_id, property_id, unit_id, tenant_id, initiated_by, move_out_date, reason,
             inspection_notes, inspection_findings, damages, damages_cost, outstanding_rent, deposit_held, deposit_refund,
             refund_status, meter_water, meter_electricity, keys_returned, keys_notes, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lease.id, lease.property_id, lease.unit_id, lease.tenant_id, req.user.id, payload.move_out_date, payload.reason,
            payload.inspection_notes, payload.inspection_findings, payload.damages, payload.damages_cost, payload.outstanding_rent,
            payload.deposit_held, payload.deposit_refund, payload.refund_status, payload.meter_water, payload.meter_electricity,
            payload.keys_returned, payload.keys_notes, payload.notes,
          ]
        );
      }

      const has = (v) => v !== undefined && v !== null && v !== '';
      const damages = Array.isArray(req.body.damages)
        ? req.body.damages.filter((d) => d && (d.description || d.cost))
        : null;
      const base = record || payload;
      const settlement = {
        move_out_date: has(req.body.move_out_date) ? req.body.move_out_date : (base.move_out_date || new Date().toISOString().slice(0, 10)),
        reason: has(req.body.reason) ? req.body.reason : base.reason,
        inspection_notes: has(req.body.inspection_notes) ? req.body.inspection_notes : base.inspection_notes,
        inspection_findings: has(req.body.inspection_findings)
          ? (typeof req.body.inspection_findings === 'string' ? req.body.inspection_findings : JSON.stringify(req.body.inspection_findings))
          : base.inspection_findings,
        damages: damages ? JSON.stringify(damages) : base.damages,
        damages_cost: has(req.body.damages_cost) ? Number(req.body.damages_cost) : base.damages_cost,
        outstanding_rent: leaseArrears(lease).total,
        deposit_held: has(req.body.deposit_held) ? Number(req.body.deposit_held) : base.deposit_held,
        deposit_refund: has(req.body.deposit_refund) ? Number(req.body.deposit_refund) : base.deposit_refund,
        refund_status: req.body.refund_status || base.refund_status || 'pending',
        meter_water: has(req.body.meter_water) ? req.body.meter_water : base.meter_water,
        meter_electricity: has(req.body.meter_electricity) ? req.body.meter_electricity : base.meter_electricity,
        keys_returned: has(req.body.keys_returned) ? (req.body.keys_returned ? 1 : 0) : base.keys_returned,
        keys_notes: has(req.body.keys_notes) ? req.body.keys_notes : base.keys_notes,
        notes: has(req.body.notes) ? req.body.notes : base.notes,
      };
      validateSettlement(settlement);

      const moveDate = settlement.move_out_date;
      run(
        `UPDATE move_outs SET status = 'completed', completed_at = ?, completed_by = ?,
           move_out_date = ?, reason = ?, inspection_notes = ?, inspection_findings = ?,
           damages = ?, damages_cost = ?, outstanding_rent = ?, deposit_held = ?, deposit_refund = ?,
           refund_status = ?, meter_water = ?, meter_electricity = ?, keys_returned = ?, keys_notes = ?, notes = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [
          new Date().toISOString(), req.user.id, moveDate,
          settlement.reason, settlement.inspection_notes, settlement.inspection_findings,
          settlement.damages, settlement.damages_cost,
          settlement.outstanding_rent, settlement.deposit_held, settlement.deposit_refund,
          settlement.refund_status,
          settlement.meter_water, settlement.meter_electricity,
          settlement.keys_returned, settlement.keys_notes, settlement.notes,
          recordId,
        ]
      );
      run(`UPDATE leases SET status = 'terminated', end_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [
        moveDate,
        lease.id,
      ]);
      run("UPDATE units SET status = 'vacant', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [lease.unit_id]);

      const finalMo = get('SELECT * FROM move_outs WHERE id = ?', [recordId]);
      const finalLease = get(`${SELECT_LEASE} WHERE l.id = ?`, [lease.id]);
      const unitOut = get('SELECT id, status FROM units WHERE id = ?', [lease.unit_id]);
      return { moveOut: toMoveOut(finalLease, finalMo), leaseOut: finalLease, unitOut };
    });

    notify(lease.tenant_id, {
      type: 'moveout',
      title: 'Move-out completed',
      body: `Your move-out from Unit ${lease.unit_number} at ${lease.property_name} is complete. Outstanding balance of KES ${Number(moveOut.outstanding_rent).toLocaleString('en-KE')} has been recorded${moveOut.deposit_held ? `; deposit of KES ${Number(moveOut.deposit_held).toLocaleString('en-KE')} is ${moveOut.refund_status}` : ''}. Your account and history are preserved.`,
      link: '/tenant',
    });
    notify(lease.landlord_id, {
      type: 'moveout',
      title: 'Move-out completed',
      body: `${lease.tenant_name} moved out of Unit ${lease.unit_number} at ${lease.property_name}. Damages KES ${Number(moveOut.damages_cost).toLocaleString('en-KE')}, outstanding rent KES ${Number(moveOut.outstanding_rent).toLocaleString('en-KE')}. Unit released.`,
      link: '/landlord/moveouts',
      dedupeKey: `moveout-complete-${moveOut.id}`,
    });

    audit(req, 'moveout.completed', 'move_out', moveOut.id, { outstanding_rent: moveOut.outstanding_rent, damages_cost: moveOut.damages_cost }, { property_id: lease.property_id });
    audit(req, 'unit.released', 'unit', lease.unit_id, { lease_id: lease.id }, { property_id: lease.property_id });
    res.json({ ok: true, move_out: moveOut, lease: leaseOut, unit: unitOut });
  })
);

export default router;
