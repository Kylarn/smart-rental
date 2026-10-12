import express from 'express';
import bcrypt from 'bcryptjs';
import { all, get, insert, run, tx } from '../db/index.js';
import { asyncHandler, notFound, forbidden, badRequest, validate, normalizePhone, parseJson, formatDate } from '../utils/helpers.js';
import { requireAuth } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { activeLeaseOfUnit, isCaretakerOfProperty } from '../services/rent.js';

const router = express.Router();
router.use(requireAuth);

function shiftYear(ymd, years) {
  const [y, m, d] = ymd.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  const day = Math.min(Number(d) || 1, lastDay);
  return `${String(y + years).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SELECT_APP = `
  SELECT a.*, p.name AS property_name, p.landlord_id, p.county, p.area,
         u.unit_number, u.unit_type, u.rent AS unit_rent,
         r.full_name AS reviewer_name,
         applicant.status AS applicant_status
  FROM applications a
  JOIN properties p ON p.id = a.property_id
  LEFT JOIN units u ON u.id = a.unit_id
  LEFT JOIN users r ON r.id = a.reviewed_by
  LEFT JOIN users applicant ON applicant.id = a.applicant_id`;

function serialize(a) {
  return { ...a, documents: parseJson(a.documents, []) };
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
      where.push('a.applicant_id = ?');
      params.push(req.user.id);
    }
    if (req.query.status) {
      where.push('a.status = ?');
      params.push(req.query.status);
    }
    if (req.query.property_id) {
      where.push('a.property_id = ?');
      params.push(Number(req.query.property_id));
    }
    let sql = SELECT_APP;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY a.created_at DESC';
    const rows = all(sql, params);
    res.json({ applications: rows.map(serialize) });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const params = [];
    let where = '';
    if (req.user.role === 'landlord') {
      where = 'WHERE p.landlord_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where = 'WHERE p.id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)';
      params.push(req.user.id);
    } else if (req.user.role === 'tenant') {
      where = 'WHERE a.applicant_id = ?';
      params.push(req.user.id);
    }
    const rows = all(
      `SELECT a.status, COUNT(*) AS c FROM applications a JOIN properties p ON p.id = a.property_id ${where} GROUP BY a.status`,
      params
    );
    const stats = { pending: 0, under_review: 0, info_requested: 0, approved: 0, rejected: 0, assigned: 0 };
    rows.forEach((r) => (stats[r.status] = Number(r.c)));
    res.json({ stats });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const app = get(`${SELECT_APP} WHERE a.id = ?`, [id]);
    if (!app) throw notFound('Application not found');
    if (req.user.role === 'landlord' && app.landlord_id !== req.user.id) throw forbidden();
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, app.property_id)) throw forbidden();
    if (req.user.role === 'tenant' && app.applicant_id !== req.user.id) throw forbidden();

    const status = req.body.status;
    const allowed = ['pending', 'under_review', 'info_requested', 'approved', 'rejected', 'assigned'];
    if (!allowed.includes(status)) throw badRequest('Invalid application status');
    if (app.status === 'assigned' && status !== 'assigned') {
      throw badRequest('This application already has an assigned lease. Terminate that lease before changing its status.', {});
    }

    if (req.user.role === 'tenant') throw forbidden('Application decisions are made by the property manager');

    if (status === 'assigned') {
      const unitId = Number(req.body.unit_id || app.unit_id);
      if (!unitId) throw badRequest('Select a unit to assign', { unit_id: 'Required' });
      const unit = get('SELECT * FROM units WHERE id = ? AND property_id = ?', [unitId, app.property_id]);
      if (!unit) throw badRequest('Unit not found on this property', { unit_id: 'Invalid unit' });
      if (activeLeaseOfUnit(unitId)) throw badRequest('That unit is already occupied', { unit_id: 'Occupied' });

      const existingTenantId = app.applicant_id;
      let newPasswordHash = null;
      if (!existingTenantId) {
        validate(req.body, {
          applicant_password: { required: true, label: 'Temporary password', minLength: 6 },
        });
        newPasswordHash = await bcrypt.hash(String(req.body.applicant_password), 10);
      }

      const okDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
      const start = req.body.start_date || app.move_in_date || new Date().toISOString().slice(0, 10);
      if (!okDate(start)) throw badRequest('Start date must be a valid YYYY-MM-DD date', { start_date: 'Invalid date' });
      const end = req.body.end_date || shiftYear(start, 1);
      if (!okDate(end) || end <= start) throw badRequest('End date must be a valid YYYY-MM-DD date after the start date', { end_date: 'Invalid date' });

      const { tenantId, leaseId } = tx(() => {
        let tenantId = existingTenantId;
        if (!tenantId) {
          tenantId = insert(
            `INSERT INTO users (role, full_name, email, phone, password_hash, county) VALUES ('tenant', ?, ?, ?, ?, ?)`,
            [app.full_name, app.email, normalizePhone(app.phone), newPasswordHash, app.county || null]
          );
        }
        const leaseId = insert(
          `INSERT INTO leases (property_id, unit_id, tenant_id, start_date, end_date, rent, deposit, frequency, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [app.property_id, unitId, tenantId, start, end, unit.rent, unit.deposit, 'monthly', `Created from application #${id}`]
        );
        run("UPDATE units SET status = 'occupied', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [unitId]);
        run(
          `UPDATE applications SET status = 'assigned', unit_id = ?, applicant_id = COALESCE(applicant_id, ?), reviewed_by = ?,
           reviewer_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
          [unitId, tenantId, req.user.id, req.body.reviewer_notes || app.reviewer_notes, id]
        );
        notify(tenantId, {
          type: 'application',
          title: 'Application approved',
          body: `You have been assigned Unit ${unit.unit_number} at ${app.property_name}. Your lease starts ${formatDate(start)}.`,
          link: '/tenant/lease',
          dedupeKey: `app-assigned-${id}`,
        });
        return { tenantId, leaseId };
      });

      audit(req, 'application.assigned', 'application', id, { unit_id: unitId, lease_id: leaseId });
      return res.json({ ok: true, status: 'assigned', lease_id: leaseId, tenant_id: tenantId });
    }

    run(
      `UPDATE applications SET status = ?, reviewer_notes = COALESCE(?, reviewer_notes), reviewed_by = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [status, req.body.reviewer_notes || null, req.user.id, id]
    );

    const messages = {
      under_review: 'Your application is now under review.',
      info_requested: `The landlord requested more information: ${req.body.reviewer_notes || 'please check your messages.'}`,
      approved: 'Your application has been approved! The landlord will assign you a unit shortly.',
      rejected: `Your application was not successful. ${req.body.reviewer_notes || ''}`.trim(),
      pending: 'Your application was moved back to pending.',
    };
    if (app.applicant_id && messages[status]) {
      notify(app.applicant_id, {
        type: 'application',
        title: `Application ${status.replace('_', ' ')}`,
        body: `${messages[status]} (${app.property_name})`,
        link: '/tenant/applications',
        dedupeKey: `app-status-${id}-${status}`,
      });
    }
    audit(req, 'application.status_changed', 'application', id, { status });
    res.json({ ok: true, status });
  })
);

export default router;
