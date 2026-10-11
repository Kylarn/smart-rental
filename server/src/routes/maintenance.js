import express from 'express';
import { all, get, insert, run } from '../db/index.js';
import { asyncHandler, notFound, forbidden, badRequest, validate, parseJson } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { upload, fileUrl } from '../middleware/upload.js';
import { isCaretakerOfProperty } from '../services/rent.js';

const router = express.Router();
router.use(requireAuth);

const SELECT_M = `
  SELECT m.*, p.name AS property_name, p.landlord_id, u.unit_number, u.unit_type,
         t.full_name AS tenant_name, t.phone AS tenant_phone, t.avatar_url AS tenant_avatar
  FROM maintenance_requests m
  JOIN properties p ON p.id = m.property_id
  LEFT JOIN units u ON u.id = m.unit_id
  LEFT JOIN users t ON t.id = m.tenant_id`;

const STATUSES = ['submitted', 'under_review', 'assigned', 'in_progress', 'completed', 'closed'];

function serialize(m) {
  return {
    ...m,
    photos: parseJson(m.photos, []),
    can_advance: STATUSES.indexOf(m.status) < STATUSES.length - 1,
  };
}

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
      where.push('m.tenant_id = ?');
      params.push(req.user.id);
    }
    ['status', 'priority', 'category'].forEach((f) => {
      if (req.query[f]) {
        where.push(`m.${f} = ?`);
        params.push(req.query[f]);
      }
    });
    if (req.query.property_id) {
      where.push('m.property_id = ?');
      params.push(Number(req.query.property_id));
    }
    let sql = SELECT_M;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY m.created_at DESC';
    const rows = all(sql, params);
    const stats = {
      total: rows.length,
      open: rows.filter((r) => !['completed', 'closed'].includes(r.status)).length,
      urgent: rows.filter((r) => r.priority === 'urgent' && !['completed', 'closed'].includes(r.status)).length,
      completed: rows.filter((r) => r.status === 'completed').length,
    };
    res.json({ requests: rows.map(serialize), stats });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = get(`${SELECT_M} WHERE m.id = ?`, [Number(req.params.id)]);
    if (!row) throw notFound('Request not found');
    if (req.user.role === 'landlord' && row.landlord_id !== req.user.id) throw notFound('Request not found');
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, row.property_id)) throw notFound('Request not found');
    if (req.user.role === 'tenant' && row.tenant_id !== req.user.id) throw forbidden();
    res.json({ request: serialize(row) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    validate(req.body, {
      title: { required: true, label: 'Issue title', minLength: 4 },
      description: { required: true, label: 'Description', minLength: 10 },
      property_id: { required: true, label: 'Property', type: 'number' },
    });

    let propertyId = Number(req.body.property_id);
    let unitId = req.body.unit_id ? Number(req.body.unit_id) : null;
    let tenantId = req.user.role === 'tenant' ? req.user.id : req.body.tenant_id ? Number(req.body.tenant_id) : null;

    if (req.user.role === 'tenant') {
      const lease = get(
        `SELECT l.*, p.landlord_id FROM leases l JOIN properties p ON p.id = l.property_id
         WHERE l.tenant_id = ? AND l.status = 'active'`,
        [req.user.id]
      );
      if (!lease) throw badRequest('You need an active lease to submit maintenance requests');
      propertyId = lease.property_id;
      unitId = lease.unit_id;
    } else {
      const property = get('SELECT * FROM properties WHERE id = ?', [propertyId]);
      if (!property) throw notFound('Property not found');
      if (req.user.role === 'landlord' && property.landlord_id !== req.user.id) throw forbidden();
      if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, property.id)) throw forbidden();
      if (unitId) {
        const unit = get('SELECT id FROM units WHERE id = ? AND property_id = ?', [unitId, propertyId]);
        if (!unit) throw badRequest('Unit does not belong to the selected property');
      }
      if (tenantId) {
        const bound = get(
          `SELECT 1 AS x FROM leases l WHERE l.tenant_id = ? AND l.property_id = ? AND l.status = 'active'`,
          [tenantId, propertyId]
        );
        if (!bound) throw badRequest('That tenant does not have an active lease on this property');
      }
    }

    const category = req.body.category || 'General';
    const isComplaint = String(category).toLowerCase().includes('complaint');
    const id = insert(
      `INSERT INTO maintenance_requests (property_id, unit_id, tenant_id, title, description, category, priority, status, photos, estimated_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
      [
        propertyId,
        unitId,
        tenantId,
        String(req.body.title).trim(),
        String(req.body.description).trim(),
        category,
        req.body.priority || 'medium',
        JSON.stringify(req.body.photos || []),
        req.body.estimated_cost ? Number(req.body.estimated_cost) : null,
      ]
    );

    const caretakers = all('SELECT caretaker_id FROM property_caretakers WHERE property_id = ?', [propertyId]);
    caretakers.forEach((c) =>
      notify(c.caretaker_id, {
        type: 'maintenance',
        title: isComplaint ? 'New complaint' : 'New maintenance request',
        body: `${req.body.title} (${req.body.priority} priority).`,
        link: '/caretaker/maintenance',
        dedupeKey: `maint-caretaker-${id}`,
      })
    );
    all('SELECT landlord_id FROM properties WHERE id = ?', [propertyId]).forEach((p) =>
      notify(p.landlord_id, {
        type: 'maintenance',
        title: isComplaint ? 'New complaint' : 'New maintenance request',
        body: `${req.body.title} (${req.body.priority} priority).`,
        link: '/landlord/maintenance',
        dedupeKey: `maint-${id}`,
      })
    );
    audit(req, isComplaint ? 'complaint.created' : 'maintenance.created', 'maintenance', id, { title: req.body.title, category }, { property_id: propertyId });
    res.status(201).json({ ok: true, id, request: serialize(get(`${SELECT_M} WHERE m.id = ?`, [id])) });
  })
);

router.post(
  '/:id/photos',
  requireRole('tenant', 'landlord', 'admin', 'caretaker'),
  upload.array('photos', 6),
  asyncHandler(async (req, res) => {
    const row = get(`${SELECT_M} WHERE m.id = ?`, [Number(req.params.id)]);
    if (!row) throw notFound('Request not found');
    if (req.user.role === 'landlord' && row.landlord_id !== req.user.id) throw forbidden();
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, row.property_id)) throw forbidden();
    if (req.user.role === 'tenant' && row.tenant_id !== req.user.id) throw forbidden();
    const photos = [...parseJson(row.photos, []), ...(req.files || []).map((f) => fileUrl(f.filename))].slice(0, 8);
    run('UPDATE maintenance_requests SET photos = ? WHERE id = ?', [JSON.stringify(photos), row.id]);
    res.json({ photos });
  })
);

router.patch(
  '/:id',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = get(`${SELECT_M} WHERE m.id = ?`, [id]);
    if (!row) throw notFound('Request not found');
    if (req.user.role === 'landlord' && row.landlord_id !== req.user.id) throw forbidden();
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, row.property_id)) throw forbidden();

    const updates = {};
    if (req.body.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) throw badRequest('Invalid status');
      const diff = STATUSES.indexOf(req.body.status) - STATUSES.indexOf(row.status);
      if (diff < 0 && !['submitted'].includes(req.body.status)) {
        throw badRequest('Requests move forward through the workflow (Submitted → Review → Assigned → In Progress → Completed → Closed)');
      }
      updates.status = req.body.status;
    }
    ['assigned_to', 'resolution_notes'].forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    ['estimated_cost', 'actual_cost'].forEach((f) => {
      if (req.body[f] !== undefined && req.body[f] !== '') updates[f] = Number(req.body[f]);
    });

    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        `UPDATE maintenance_requests SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [...keys.map((k) => updates[k]), id]
      );
      if (row.tenant_id) {
        notify(row.tenant_id, {
          type: 'maintenance',
          title: `Maintenance ${updates.status ? updates.status.replace('_', ' ') : 'updated'}`,
          body: `${row.title} — ${updates.status ? `status is now ${updates.status.replace('_', ' ')}` : 'details updated'}.`,
          link: '/tenant/maintenance',
          dedupeKey: `maint-update-${id}-${updates.status || keys.join('-')}`,
        });
      }
      audit(req, 'maintenance.updated', 'maintenance', id, { fields: keys, status: updates.status }, { property_id: row.property_id });
    }
    res.json({ request: serialize(get(`${SELECT_M} WHERE m.id = ?`, [id])) });
  })
);

export default router;
