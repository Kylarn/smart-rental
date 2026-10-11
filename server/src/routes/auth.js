import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get, insert, run } from '../db/index.js';
import { asyncHandler, validate, badRequest, conflict, unauthorized, normalizePhone } from '../utils/helpers.js';
import { requireAuth, signToken, setAuthCookie, clearAuthCookie, COOKIE_NAME } from '../middleware/auth.js';
import { audit } from '../services/notify.js';

const router = express.Router();

const PUBLIC_USER_COLUMNS =
  'id, role, full_name, email, phone, status, avatar_url, county, id_number, bio, created_at';

function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    validate(req.body, {
      full_name: { required: true, label: 'Full name', minLength: 3 },
      email: { required: true, label: 'Email', type: 'email' },
      phone: { required: true, label: 'Phone', type: 'phone' },
      password: { required: true, label: 'Password', minLength: 6 },
    });
    const role = req.body.role === 'landlord' ? 'landlord' : 'tenant';
    const email = String(req.body.email).trim().toLowerCase();
    if (get('SELECT id FROM users WHERE email = ?', [email])) throw conflict('An account with this email already exists');
    const phone = normalizePhone(req.body.phone);
    const password_hash = await bcrypt.hash(String(req.body.password), 10);
    const id = insert(
      `INSERT INTO users (role, full_name, email, phone, password_hash, county) VALUES (?, ?, ?, ?, ?, ?)`,
      [role, String(req.body.full_name).trim(), email, phone, password_hash, req.body.county || null]
    );
    const user = get(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [id]);
    setAuthCookie(res, signToken(user));
    audit(req, 'auth.register', 'user', id, { role, email });
    res.status(201).json({ user });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    validate(req.body, {
      email: { required: true, label: 'Email', type: 'email' },
      password: { required: true, label: 'Password' },
    });
    const email = String(req.body.email).trim().toLowerCase();
    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(await bcrypt.compare(String(req.body.password), user.password_hash))) {
      throw unauthorized('Invalid email or password');
    }
    if (user.status === 'suspended') {
      throw badRequest('This account has been suspended. Please contact support.');
    }
    setAuthCookie(res, signToken(user));
    audit(req, 'auth.login', 'user', user.id);
    res.json({ user: publicUser(user) });
  })
);

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.json({ user: null });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = get(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [payload.id]);
    res.json({ user: user && user.status === 'active' ? user : null });
  } catch {
    res.json({ user: null });
  }
});

router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const updates = {};
    if (req.body.full_name !== undefined) {
      if (String(req.body.full_name).trim().length < 3) throw badRequest('Please provide your full name', { full_name: 'Too short' });
      updates.full_name = String(req.body.full_name).trim();
    }
    if (req.body.phone !== undefined) {
      const phone = normalizePhone(req.body.phone);
      if (!phone) throw badRequest('Please provide a valid Kenyan phone number', { phone: 'Use format 0712345678' });
      updates.phone = phone;
    }
    if (req.body.county !== undefined) updates.county = req.body.county;
    if (req.body.id_number !== undefined) updates.id_number = req.body.id_number;
    if (req.body.bio !== undefined) updates.bio = req.body.bio;
    if (req.body.avatar_url !== undefined) updates.avatar_url = req.body.avatar_url;

    const keys = Object.keys(updates);
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      run(`UPDATE users SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [
        ...keys.map((k) => updates[k]),
        req.user.id,
      ]);
      audit(req, 'user.profile_updated', 'user', req.user.id, { fields: keys });
    }
    res.json({ user: get(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [req.user.id]) });
  })
);

router.put(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    validate(req.body, {
      current_password: { required: true, label: 'Current password' },
      new_password: { required: true, label: 'New password', minLength: 6 },
    });
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const ok = await bcrypt.compare(String(req.body.current_password), user.password_hash);
    if (!ok) throw badRequest('Your current password is incorrect', { current_password: 'Incorrect password' });
    const hash = await bcrypt.hash(String(req.body.new_password), 10);
    run('UPDATE users SET password_hash = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [hash, req.user.id]);
    audit(req, 'auth.password_changed', 'user', req.user.id);
    res.json({ ok: true });
  })
);

export default router;
