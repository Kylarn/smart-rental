import express from 'express';
import bcrypt from 'bcryptjs';
import { all, get, insert, run } from '../db/index.js';
import { asyncHandler, notFound, forbidden, badRequest, conflict, normalizePhone, parseJson, validate } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { upload, fileUrl } from '../middleware/upload.js';
import { propertyStats, activeLeaseOfUnit, isCaretakerOfProperty } from '../services/rent.js';

const router = express.Router();

export function assertPropertyAccess(propertyId, user) {
  const property = get('SELECT * FROM properties WHERE id = ?', [propertyId]);
  if (!property) throw notFound('Property not found');
  if (user.role === 'admin') return property;
  if (property.landlord_id === user.id) return property;
  if (user.role === 'caretaker' && isCaretakerOfProperty(user.id, property.id)) return property;
  throw forbidden('You do not have access to this property');
}

function serializeProperty(p) {
  return {
    ...p,
    amenities: parseJson(p.amenities, []),
    images: parseJson(p.images, []),
    stats: propertyStats(p.id),
  };
}

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, search, county } = req.query;
    const params = [];
    let sql = `SELECT p.*, u.full_name AS landlord_name FROM properties p JOIN users u ON u.id = p.landlord_id`;
    const where = [];
    if (req.user.role === 'landlord') {
      where.push('p.landlord_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where.push('p.id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)');
      params.push(req.user.id);
    }
    if (status) {
      where.push('p.status = ?');
      params.push(status);
    }
    if (county) {
      where.push('p.county = ?');
      params.push(county);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (search) {
      sql += `${where.length ? ' AND' : ' WHERE'} (p.name LIKE ? OR p.area LIKE ? OR p.county LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY p.created_at DESC';
    let rows = all(sql, params);
    if (req.user.role === 'admin' && req.query.landlord_id) {
      rows = rows.filter((r) => r.landlord_id === Number(req.query.landlord_id));
    }
    res.json({ properties: rows.map(serializeProperty) });
  })
);

router.post(
  '/',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    validate(req.body, {
      name: { required: true, label: 'Property name', minLength: 3 },
      county: { required: true, label: 'County' },
      property_type: { required: true, label: 'Property type' },
    });
    const id = insert(
      `INSERT INTO properties (landlord_id, name, county, area, address, property_type, description, amenities, images, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.role === 'admin' && req.body.landlord_id ? Number(req.body.landlord_id) : req.user.id,
        String(req.body.name).trim(),
        String(req.body.county).trim(),
        req.body.area || '',
        req.body.address || '',
        req.body.property_type || 'Apartment',
        req.body.description || '',
        JSON.stringify(req.body.amenities || []),
        JSON.stringify(req.body.images || []),
        req.body.status || 'active',
      ]
    );
    audit(req, 'property.created', 'property', id, { name: req.body.name });
    res.status(201).json({ property: serializeProperty(get('SELECT * FROM properties WHERE id = ?', [id])) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    const units = all(
      `SELECT u.*,
              (SELECT COUNT(*) FROM leases l WHERE l.unit_id = u.id AND l.status = 'active') AS active_leases
       FROM units u WHERE u.property_id = ? ORDER BY CAST(u.unit_number AS INTEGER), u.unit_number`,
      [property.id]
    );
    const landlord = get('SELECT id, full_name, email, phone, avatar_url FROM users WHERE id = ?', [property.landlord_id]);
    const caretakers = all(
      `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status, pc.created_at AS assigned_at
       FROM property_caretakers pc JOIN users u ON u.id = pc.caretaker_id
       WHERE pc.property_id = ? ORDER BY u.full_name`,
      [property.id]
    );
    const unitRows = units.map((u) => ({
      ...u,
      amenities: parseJson(u.amenities, []),
      tenant: u.status === 'occupied' ? tenantOfUnit(u.id) : null,
    }));

    const page = req.query.page ? Number(req.query.page) : null;
    const limit = req.query.limit ? Number(req.query.limit) : null;
    const hasPagination = Number.isInteger(page) && page > 0 && Number.isInteger(limit) && limit > 0;

    if (!hasPagination) {
      return res.json({
        property: serializeProperty(property),
        units: unitRows,
        landlord,
        caretakers,
      });
    }

    const total = unitRows.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, pages);
    const offset = (currentPage - 1) * limit;
    const paginated = unitRows.slice(offset, offset + limit);

    res.json({
      property: serializeProperty(property),
      units: paginated,
      landlord,
      caretakers,
      pagination: {
        page: currentPage,
        limit,
        total,
        pages,
      },
    });
  })
);

router.get(
  '/:id/register',
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    const register = all(
      `SELECT r.*, u.unit_number, u.floor FROM rental_register r
       LEFT JOIN units u ON u.id = r.unit_id
       WHERE r.property_id = ?
       ORDER BY CAST(COALESCE(u.unit_number, r.room_label) AS INTEGER), r.room_label`,
      [property.id]
    );
    const rent = all(
      `SELECT e.*, r.room_label, u.unit_number FROM rent_register_entries e
       LEFT JOIN rental_register r ON r.id = e.rental_register_id
       LEFT JOIN units u ON u.id = e.unit_id
       WHERE e.property_id = ?
       ORDER BY e.period, CAST(COALESCE(u.unit_number, r.room_label) AS INTEGER), r.room_label`,
      [property.id]
    );
    const deposits = all(
      `SELECT d.*, r.room_label, u.unit_number FROM deposits d
       LEFT JOIN rental_register r ON r.id = d.rental_register_id
       LEFT JOIN units u ON u.id = d.unit_id
       WHERE d.property_id = ?
       ORDER BY d.tenant_name`,
      [property.id]
    );
    const statusRow = get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'caretaker_accommodation' THEN 1 ELSE 0 END) AS caretaker,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'moved_out' THEN 1 ELSE 0 END) AS moved_out,
              SUM(CASE WHEN details_verified = 0 THEN 1 ELSE 0 END) AS unverified_details,
              SUM(CASE WHEN contact_verified = 0 THEN 1 ELSE 0 END) AS unverified_contacts
       FROM rental_register WHERE property_id = ?`,
      [property.id]
    );
    const depositRow = get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total,
              SUM(CASE WHEN verified = 0 THEN 1 ELSE 0 END) AS unverified
       FROM deposits WHERE property_id = ?`,
      [property.id]
    );
    const rentRow = get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total,
              MIN(period) AS first_period, MAX(period) AS last_period,
              SUM(CASE WHEN date_verified = 0 THEN 1 ELSE 0 END) AS unverified_dates,
              SUM(CASE WHEN amount_verified = 0 THEN 1 ELSE 0 END) AS unverified_amounts
       FROM rent_register_entries WHERE property_id = ?`,
      [property.id]
    );
    const occupancy = get(
      `SELECT COUNT(*) AS units,
              SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
              SUM(CASE WHEN status = 'vacant' AND occupancy_known = 1 THEN 1 ELSE 0 END) AS vacant,
              SUM(CASE WHEN occupancy_known = 0 THEN 1 ELSE 0 END) AS unknown_occupancy,
              SUM(CASE WHEN details_verified = 0 THEN 1 ELSE 0 END) AS unverified_details,
              SUM(CASE WHEN rent = 0 THEN 1 ELSE 0 END) AS rent_unknown
       FROM units WHERE property_id = ?`,
      [property.id]
    );
    res.json({
      property: { id: property.id, name: property.name, status: property.status },
      occupancy: {
        units: Number(occupancy.units || 0),
        occupied: Number(occupancy.occupied || 0),
        vacant: Number(occupancy.vacant || 0),
        unknown_occupancy: Number(occupancy.unknown_occupancy || 0),
        unverified_details: Number(occupancy.unverified_details || 0),
        rent_unknown: Number(occupancy.rent_unknown || 0),
      },
      register,
      registerSummary: {
        total: Number(statusRow.total || 0),
        caretaker_accommodation: Number(statusRow.caretaker || 0),
        pending: Number(statusRow.pending || 0),
        verified: Number(statusRow.verified || 0),
        active: Number(statusRow.active || 0),
        moved_out: Number(statusRow.moved_out || 0),
        unverified_details: Number(statusRow.unverified_details || 0),
        unverified_contacts: Number(statusRow.unverified_contacts || 0),
      },
      rent,
      rentSummary: {
        count: Number(rentRow.count || 0),
        total: Number(rentRow.total || 0),
        first_period: rentRow.first_period,
        last_period: rentRow.last_period,
        unverified_dates: Number(rentRow.unverified_dates || 0),
        unverified_amounts: Number(rentRow.unverified_amounts || 0),
      },
      deposits,
      depositSummary: {
        count: Number(depositRow.count || 0),
        total: Number(depositRow.total || 0),
        unverified: Number(depositRow.unverified || 0),
      },
    });
  })
);

router.get(
  '/:id/caretakers',
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    const caretakers = all(
      `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.status, pc.created_at AS assigned_at
       FROM property_caretakers pc JOIN users u ON u.id = pc.caretaker_id
       WHERE pc.property_id = ? ORDER BY u.full_name`,
      [property.id]
    );
    res.json({ caretakers });
  })
);

router.post(
  '/:id/caretakers',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    let caretakerId = req.body.caretaker_id ? Number(req.body.caretaker_id) : null;

    if (caretakerId) {
      const caretaker = get('SELECT * FROM users WHERE id = ? AND role = ?', [caretakerId, 'caretaker']);
      if (!caretaker) throw badRequest('No caretaker user found with that id', { caretaker_id: 'Invalid caretaker' });
      if (caretaker.status === 'suspended') throw badRequest('This caretaker account is suspended');
    } else {
      validate(req.body, {
        full_name: { required: true, label: 'Caretaker name', minLength: 3 },
        email: { required: true, label: 'Email', type: 'email' },
        phone: { required: true, label: 'Phone', type: 'phone' },
      });
      const email = String(req.body.email).trim().toLowerCase();
      const existing = get('SELECT * FROM users WHERE email = ?', [email]);
      if (existing && existing.role !== 'caretaker') throw conflict('This email belongs to a non-caretaker account');
      if (existing && existing.status === 'suspended') throw badRequest('This caretaker account is suspended');
      caretakerId = existing?.id;
      if (!caretakerId) {
        const password = req.body.password ? String(req.body.password) : `SR-${Math.random().toString(36).slice(2, 10)}`;
        const hash = await bcrypt.hash(password, 10);
        caretakerId = insert(
          `INSERT INTO users (role, full_name, email, phone, password_hash, county) VALUES ('caretaker', ?, ?, ?, ?, ?)`,
          [String(req.body.full_name).trim(), email, normalizePhone(req.body.phone), hash, req.body.county || null]
        );
      }
    }

    run(
      `INSERT INTO property_caretakers (property_id, caretaker_id, assigned_by) VALUES (?, ?, ?)
       ON CONFLICT(property_id, caretaker_id) DO NOTHING`,
      [property.id, caretakerId, req.user.id]
    );
    const caretaker = get('SELECT id, role, full_name, email, phone, avatar_url, status FROM users WHERE id = ?', [caretakerId]);
    notify(caretakerId, {
      type: 'info',
      title: 'Caretaker assignment',
      body: `You have been assigned to manage ${property.name}.`,
      link: '/app',
    });
    audit(req, 'caretaker.assigned', 'property', property.id, { caretaker_id: caretakerId }, { property_id: property.id });
    res.status(201).json({ ok: true, caretaker });
  })
);

router.delete(
  '/:id/caretakers/:caretakerId',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    run('DELETE FROM property_caretakers WHERE property_id = ? AND caretaker_id = ?', [
      property.id,
      Number(req.params.caretakerId),
    ]);
    audit(req, 'caretaker.removed', 'property', property.id, { caretaker_id: Number(req.params.caretakerId) }, { property_id: property.id });
    res.json({ ok: true });
  })
);

function tenantOfUnit(unitId) {
  const lease = activeLeaseOfUnit(unitId);
  if (!lease) return null;
  const tenant = get('SELECT id, full_name, email, phone, avatar_url FROM users WHERE id = ?', [lease.tenant_id]);
  return tenant ? { ...tenant, lease } : null;
}

router.put(
  '/:id',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    const fields = ['name', 'county', 'area', 'address', 'property_type', 'description', 'status'];
    const updates = {};
    fields.forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    if (req.body.amenities !== undefined) updates.amenities = JSON.stringify(req.body.amenities);
    if (req.body.images !== undefined) updates.images = JSON.stringify(req.body.images);
    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        `UPDATE properties SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [...keys.map((k) => updates[k]), property.id]
      );
      audit(req, 'property.updated', 'property', property.id, { fields: keys });
    }
    res.json({ property: serializeProperty(get('SELECT * FROM properties WHERE id = ?', [property.id])) });
  })
);

router.delete(
  '/:id',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    const activeLeases = get('SELECT COUNT(*) AS c FROM leases WHERE property_id = ? AND status = ?', [
      property.id,
      'active',
    ]).c;
    if (activeLeases > 0) {
      throw badRequest('This property has active leases. Terminate them before deleting.', {
        property_id: 'Active leases exist',
      });
    }
    run('DELETE FROM properties WHERE id = ?', [property.id]);
    audit(req, 'property.deleted', 'property', property.id, { name: property.name });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/images',
  requireRole('landlord', 'admin'),
  upload.array('images', 8),
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    const existing = parseJson(property.images, []);
    const added = (req.files || []).map((f) => fileUrl(f.filename));
    const images = [...existing, ...added].slice(0, 12);
    run('UPDATE properties SET images = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [
      JSON.stringify(images),
      property.id,
    ]);
    audit(req, 'property.images_added', 'property', property.id, { count: added.length });
    res.json({ images });
  })
);

router.post(
  '/:id/images/remove',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    const property = assertPropertyAccess(Number(req.params.id), req.user);
    const images = parseJson(property.images, []).filter((img) => img !== req.body.url);
    run('UPDATE properties SET images = ? WHERE id = ?', [JSON.stringify(images), property.id]);
    audit(req, 'property.image_removed', 'property', property.id);
    res.json({ images });
  })
);

export default router;
