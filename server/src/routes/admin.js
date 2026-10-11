import express from 'express';
import bcrypt from 'bcryptjs';
import { all, get, insert, run } from '../db/index.js';
import { asyncHandler, notFound, badRequest, conflict, validate, normalizePhone, parseJson } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const params = [];
    const where = [];
    if (req.query.role) {
      where.push('role = ?');
      params.push(req.query.role);
    }
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.search) {
      where.push('(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
    }
    let sql = `SELECT id, role, full_name, email, phone, status, avatar_url, county, created_at FROM users`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const users = all(sql, params).map((u) => ({
      ...u,
      properties: u.role === 'landlord' ? get('SELECT COUNT(*) AS c FROM properties WHERE landlord_id = ?', [u.id]).c : null,
      leases: u.role === 'tenant' ? get('SELECT COUNT(*) AS c FROM leases WHERE tenant_id = ?', [u.id]).c : null,
    }));
    res.json({ users });
  })
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    validate(req.body, {
      full_name: { required: true, label: 'Full name', minLength: 3 },
      email: { required: true, label: 'Email', type: 'email' },
      phone: { required: true, label: 'Phone', type: 'phone' },
      password: { required: true, label: 'Password', minLength: 6 },
      role: { required: true, label: 'Role' },
    });
    const role = ['admin', 'landlord', 'tenant', 'caretaker'].includes(req.body.role) ? req.body.role : 'tenant';
    const email = String(req.body.email).trim().toLowerCase();
    if (get('SELECT id FROM users WHERE email = ?', [email])) throw conflict('An account with this email already exists');
    const hash = await bcrypt.hash(String(req.body.password), 10);
    const id = insert(
      'INSERT INTO users (role, full_name, email, phone, password_hash, county, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [role, String(req.body.full_name).trim(), email, normalizePhone(req.body.phone), hash, req.body.county || null, 'active']
    );
    audit(req, 'admin.user_created', 'user', id, { role, email });
    res.status(201).json({ ok: true, id });
  })
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) throw notFound('User not found');
    if (id === req.user.id && req.body.status === 'suspended') throw badRequest('You cannot suspend your own account');

    const updates = {};
    if (req.body.status !== undefined) {
      if (!['active', 'suspended'].includes(req.body.status)) throw badRequest('Invalid status');
      updates.status = req.body.status;
    }
    if (req.body.role !== undefined) {
      if (!['admin', 'landlord', 'tenant', 'caretaker'].includes(req.body.role)) throw badRequest('Invalid role');
      if (id === req.user.id) throw badRequest('You cannot change your own role');
      updates.role = req.body.role;
    }
    if (req.body.full_name) updates.full_name = String(req.body.full_name).trim();
    if (req.body.county !== undefined) updates.county = req.body.county;
    if (req.body.password) updates.password_hash = await bcrypt.hash(String(req.body.password), 10);

    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [...keys.map((k) => updates[k]), id]
      );
      if (updates.status === 'suspended') {
        notify(id, {
          type: 'error',
          title: 'Account suspended',
          body: 'Your account has been suspended. Contact support for assistance.',
        });
      }
      audit(req, 'admin.user_updated', 'user', id, { fields: keys, status: updates.status, role: updates.role });
    }
    res.json({ ok: true });
  })
);

router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) throw notFound('User not found');
    if (id === req.user.id) throw badRequest('You cannot delete your own account');
    if (user.role === 'tenant') {
      const active = get(`SELECT COUNT(*) AS c FROM leases WHERE tenant_id = ? AND status = 'active'`, [id]).c;
      if (active) throw badRequest('This tenant has active leases. Terminate them first.');
    }
    if (user.role === 'landlord') {
      const props = get('SELECT COUNT(*) AS c FROM properties WHERE landlord_id = ?', [id]).c;
      if (props) throw badRequest('This landlord still has properties. Reassign or delete them first.');
    }
    run('DELETE FROM users WHERE id = ?', [id]);
    audit(req, 'admin.user_deleted', 'user', id, { email: user.email, role: user.role });
    res.json({ ok: true });
  })
);

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const params = [];
    const where = [];
    if (req.query.action) {
      where.push('a.action LIKE ?');
      params.push(`%${req.query.action}%`);
    }
    if (req.query.user_id) {
      where.push('a.user_id = ?');
      params.push(Number(req.query.user_id));
    }
    let sql = `SELECT a.*, u.full_name AS user_name, u.role AS user_role
               FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY a.created_at DESC LIMIT 300';
    const logs = all(sql, params);
    res.json({ logs });
  })
);

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const rows = all('SELECT key, value FROM settings');
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      settings: {
        platform_name: 'Smart Rentals',
        support_email: 'support@smartrentals.co.ke',
        support_phone: '0700000000',
        currency: 'KES',
        registration_enabled: 'true',
        mpesa_mode: 'sandbox',
        ...settings,
      },
    });
  })
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const allowed = [
      'platform_name',
      'support_email',
      'support_phone',
      'currency',
      'registration_enabled',
      'mpesa_mode',
      'rent_reminder_days',
      'lease_expiry_days',
    ];
    const keys = Object.keys(req.body || {}).filter((k) => allowed.includes(k));
    keys.forEach((k) => {
      run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [k, String(req.body[k])]
      );
    });
    audit(req, 'admin.settings_updated', 'settings', null, { keys });
    res.json({ ok: true, updated: keys });
  })
);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const monthly = all(
      `SELECT strftime('%Y-%m', created_at) AS ym, COUNT(*) AS signups FROM users GROUP BY ym ORDER BY ym DESC LIMIT 12`
    );
    const roleSplit = all('SELECT role, COUNT(*) AS c FROM users GROUP BY role');
    const propertyTypes = all('SELECT property_type, COUNT(*) AS c FROM properties GROUP BY property_type');
    res.json({ monthlySignups: monthly.reverse(), roleSplit, propertyTypes });
  })
);

export default router;
