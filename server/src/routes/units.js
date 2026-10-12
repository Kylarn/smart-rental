import express from 'express';
import { all, get, insert, run } from '../db/index.js';
import { asyncHandler, notFound, badRequest, validate, parseJson } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../services/notify.js';
import { assertPropertyAccess } from './properties.js';
import { activeLeaseOfUnit, leaseArrears, expandCoverage } from '../services/rent.js';

const router = express.Router();
router.use(requireAuth);

function serializeUnit(u) {
  const lease = u.status === 'occupied' ? activeLeaseOfUnit(u.id) : null;
  const tenant = lease ? get('SELECT id, full_name, email, phone, avatar_url FROM users WHERE id = ?', [lease.tenant_id]) : null;
  let arrears = { total: 0, unpaidPeriods: [], months: 0 };
  let paidThrough = null;
  if (lease) {
    arrears = leaseArrears(lease);
    const covered = expandCoverage(
      all('SELECT period, months_covered, status FROM payments WHERE lease_id = ?', [lease.id])
    );
    paidThrough = [...covered].sort().pop() || null;
  }
  return {
    ...u,
    amenities: parseJson(u.amenities, []),
    tenant: tenant ? { ...tenant } : null,
    lease,
    arrears,
    paid_through: paidThrough,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { property_id, status, type, search } = req.query;
    const params = [];
    const where = [];
    let sql = `SELECT u.*, p.name AS property_name, p.landlord_id FROM units u JOIN properties p ON p.id = u.property_id`;
    if (req.user.role === 'landlord') {
      where.push('p.landlord_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where.push('p.id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)');
      params.push(req.user.id);
    } else if (req.user.role === 'tenant') {
      where.push('u.id IN (SELECT unit_id FROM leases WHERE tenant_id = ?)');
      params.push(req.user.id);
    }
    if (property_id) {
      where.push('u.property_id = ?');
      params.push(Number(property_id));
    }
    if (status) {
      where.push('u.status = ?');
      params.push(status);
      if (status === 'vacant') where.push('COALESCE(u.occupancy_known, 1) = 1');
    }
    if (type) {
      where.push('u.unit_type = ?');
      params.push(type);
    }
    if (search) {
      where.push('(u.unit_number LIKE ? OR p.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY p.name, CAST(u.unit_number AS INTEGER), u.unit_number';
    const rows = all(sql, params);
    res.json({ units: rows.map(serializeUnit) });
  })
);

router.post(
  '/',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    validate(req.body, {
      property_id: { required: true, label: 'Property', type: 'number' },
      unit_number: { required: true, label: 'Unit number' },
      unit_type: { required: true, label: 'Unit type' },
      rent: { required: true, label: 'Monthly rent', type: 'number', min: 0 },
    });
    assertPropertyAccess(Number(req.body.property_id), req.user);
    const bedrooms = bedroomsFromType(req.body.unit_type, req.body.bedrooms);
    if (get('SELECT id FROM units WHERE property_id = ? AND unit_number = ?', [req.body.property_id, req.body.unit_number])) {
      throw badRequest('A unit with this number already exists on the property', { unit_number: 'Duplicate unit number' });
    }
    const id = insert(
      `INSERT INTO units (property_id, unit_number, floor, unit_type, bedrooms, rent, deposit, size_sqm, status, amenities, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(req.body.property_id),
        String(req.body.unit_number).trim(),
        req.body.floor || '',
        req.body.unit_type,
        bedrooms,
        Number(req.body.rent),
        Number(req.body.deposit || 0),
        req.body.size_sqm ? Number(req.body.size_sqm) : null,
        'vacant',
        JSON.stringify(req.body.amenities || []),
        req.body.description || '',
      ]
    );
    audit(req, 'unit.created', 'unit', id, { unit_number: req.body.unit_number }, { property_id: Number(req.body.property_id) });
    res.status(201).json({ unit: serializeUnit(get('SELECT * FROM units WHERE id = ?', [id])) });
  })
);

function bedroomsFromType(type, explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== '') return Number(explicit);
  const t = String(type || '').toLowerCase();
  if (t.includes('bedsitter') || t.includes('studio')) return 0;
  const match = t.match(/(\d+)\s*bed/);
  return match ? Number(match[1]) : 0;
}

router.put(
  '/:id',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const unit = get(
      `SELECT u.*, p.landlord_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`,
      [Number(req.params.id)]
    );
    if (!unit) throw notFound('Unit not found');
    assertPropertyAccess(unit.property_id, req.user);

    const updates = {};
    ['unit_number', 'floor', 'unit_type', 'rent', 'deposit', 'size_sqm', 'status', 'description'].forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    if (req.body.amenities !== undefined) updates.amenities = JSON.stringify(req.body.amenities);
    if (req.body.unit_type !== undefined) updates.bedrooms = bedroomsFromType(req.body.unit_type, req.body.bedrooms);

    if (updates.status && updates.status !== unit.status) {
      const lease = activeLeaseOfUnit(unit.id);
      if (updates.status === 'vacant' && lease) {
        throw badRequest('This unit has an active lease. Terminate the lease first.');
      }
      if (['occupied', 'reserved'].includes(updates.status) && !lease && updates.status === 'occupied') {
        throw badRequest('Create a lease for this unit before marking it occupied.');
      }
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        `UPDATE units SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [...keys.map((k) => updates[k]), unit.id]
      );
      audit(req, 'unit.updated', 'unit', unit.id, { fields: keys }, { property_id: unit.property_id });
    }
    res.json({ unit: serializeUnit(get('SELECT * FROM units WHERE id = ?', [unit.id])) });
  })
);

router.delete(
  '/:id',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const unit = get(
      `SELECT u.*, p.landlord_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`,
      [Number(req.params.id)]
    );
    if (!unit) throw notFound('Unit not found');
    assertPropertyAccess(unit.property_id, req.user);
    if (activeLeaseOfUnit(unit.id)) throw badRequest('This unit has an active lease and cannot be deleted.');
    run('DELETE FROM units WHERE id = ?', [unit.id]);
    audit(req, 'unit.deleted', 'unit', unit.id, { unit_number: unit.unit_number }, { property_id: unit.property_id });
    res.json({ ok: true });
  })
);

export default router;
