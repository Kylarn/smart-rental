import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get, all, insert, run } from '../db/index.js';
import { asyncHandler, validate, badRequest, conflict, unauthorized, forbidden, normalizePhone } from '../utils/helpers.js';
import { requireAuth, signToken, setAuthCookie, clearAuthCookie, COOKIE_NAME } from '../middleware/auth.js';
import { audit, notifyMany } from '../services/notify.js';
import { settingBool } from '../services/settings.js';

const router = express.Router();

const PUBLIC_USER_COLUMNS =
  'id, role, full_name, email, phone, status, approval_status, avatar_url, county, id_number, bio, sms_opt_out, created_at';

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
    const needsApproval = role === 'landlord' && settingBool('landlord_approval', true);
    const id = insert(
      `INSERT INTO users (role, full_name, email, phone, password_hash, county, approval_status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [role, String(req.body.full_name).trim(), email, phone, password_hash, req.body.county || null, needsApproval ? 'pending' : 'approved']
    );
    const user = get(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [id]);
    audit(req, 'auth.register', 'user', id, { role, email, pending: needsApproval });
    if (needsApproval) {
      notifyMany(
        all("SELECT id FROM users WHERE role = 'admin'").map((a) => a.id),
        {
          type: 'info',
          title: 'Landlord awaiting approval',
          body: `${String(req.body.full_name).trim()} (${email}) registered as a landlord and needs approval.`,
          link: '/admin/users',
          dedupeKey: `landlord-pending-${id}`,
        }
      );
      return res.status(201).json({
        user,
        pending: true,
        message: 'Your landlord account has been created and is awaiting admin approval. You can sign in once it is approved.',
      });
    }
    setAuthCookie(res, signToken(user));
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
      throw forbidden('This account has been suspended. Contact support for assistance.');
    }
    if (user.approval_status === 'pending') {
      throw forbidden('Your landlord account is awaiting admin approval. You will be able to sign in once it is approved.');
    }
    if (user.approval_status === 'rejected') {
      throw forbidden('Your landlord account application was not approved. Contact support for assistance.');
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
    res.json({ user: user && user.status === 'active' && user.approval_status === 'approved' ? user : null });
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
