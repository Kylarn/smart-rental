import bcrypt from 'bcryptjs';
import express from 'express';
import { get, run } from '../db/index.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, validate } from '../utils/helpers.js';
import { auditLog, notify } from '../services/notify.js';
import { smsEvents } from '../services/sms/events.js';
import { createActivationToken, findActivation, activationStatus, consumeActivation } from '../services/activation.js';

const router = express.Router();

function activationInfo(row) {
  const user = get('SELECT id, full_name, email, phone, role, status FROM users WHERE id = ?', [row.user_id]);
  return { activation: row, user };
}

router.get(
  '/activation/:token',
  asyncHandler(async (req, res) => {
    const row = findActivation(req.params.token);
    const status = activationStatus(row);
    if (status !== 'valid') {
      return res.json({ valid: false, status });
    }
    const { user } = activationInfo(row);
    if (!user || user.role !== 'tenant') return res.json({ valid: false, status: 'invalid' });
    res.json({
      valid: true,
      status,
      full_name: user.full_name,
      email: user.email,
      expires_at: row.expires_at,
    });
  })
);

router.post(
  '/activation',
  asyncHandler(async (req, res) => {
    validate(req.body, {
      token: { required: true, label: 'Activation token' },
      password: { required: true, label: 'Password', minLength: 6 },
    });
    const row = findActivation(req.body.token);
    const status = activationStatus(row);
    if (status !== 'valid') {
      throw badRequest('This activation link is invalid or has expired. Request a new one.');
    }
    const { user } = activationInfo(row);
    if (!user || user.role !== 'tenant') {
      throw badRequest('This activation link is invalid or has expired. Request a new one.');
    }
    const hash = await bcrypt.hash(String(req.body.password), 10);
    run(
      `UPDATE users SET password_hash = ?, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [hash, user.id]
    );
    consumeActivation(row.id);
    notify(user.id, {
      type: 'success',
      title: 'Account activated',
      body: 'Your Smart Rentals tenant account is now active. Welcome aboard!',
      link: '/app',
    });
    auditLog(user.id, 'account.activated', 'user', user.id, { activation_id: row.id }, req.ip, row.property_id, 'tenant');
    res.json({ ok: true, message: 'Your account is active. You can now sign in.' });
  })
);

router.post(
  '/activation/resend',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (email) {
      const user = get('SELECT id, role, phone, status FROM users WHERE email = ?', [email]);
      if (user && user.role === 'tenant') {
        const lease = get(
          `SELECT p.name AS property_name FROM leases l JOIN properties p ON p.id = l.property_id
           WHERE l.tenant_id = ? ORDER BY l.created_at DESC LIMIT 1`,
          [user.id]
        );
        const { url, expiresAt } = createActivationToken({ userId: user.id, purpose: 'activation' });
        smsEvents.accountActivation({
          userId: user.id,
          url,
          propertyName: lease?.property_name,
          dedupeKey: `sms-activation-${user.id}-${Date.now()}`,
        });
        auditLog(user.id, 'account.activation_resent', 'user', user.id, { expires_at: expiresAt }, req.ip, null, 'tenant');
      }
    }
    res.json({ ok: true, message: 'If an account exists for that email, a new activation link has been sent.' });
  })
);

export default router;
