import express from 'express';
import { all, get, run } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound, unauthorized } from '../utils/helpers.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { audit } from '../services/notify.js';
import { markSmsDelivery, listSmsProviders, flushSmsQueue, smsEnabled } from '../services/sms/index.js';
import { verifySmsWebhookSignature } from '../services/sms/webhookAuth.js';
import { landlordPropertyIds, caretakerPropertyIds, placeholders } from '../services/rent.js';

const router = express.Router();

const SELECT_SMS = `SELECT id, user_id, property_id, phone, message, event_type, related_entity, related_id,
  status, provider, provider_message_id, attempts, simulated, error, sent_at, delivered_at, created_at
  FROM sms_messages`;

function scopeFor(user) {
  if (user.role === 'admin') return { where: '', params: [] };
  if (user.role === 'landlord') {
    const ids = landlordPropertyIds(user.id);
    if (!ids.length) return { where: 'WHERE user_id = ?', params: [user.id] };
    return { where: `WHERE (property_id IN (${placeholders(ids)}) OR user_id = ?)`, params: [...ids, user.id] };
  }
  if (user.role === 'caretaker') {
    const ids = caretakerPropertyIds(user.id);
    if (!ids.length) return { where: 'WHERE user_id = ?', params: [user.id] };
    return { where: `WHERE property_id IN (${placeholders(ids)})`, params: ids };
  }
  return { where: 'WHERE user_id = ?', params: [user.id] };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { where, params } = scopeFor(req.user);
    const clauses = [];
    const queryParams = [...params];
    if (where) clauses.push(where.replace(/^WHERE /, ''));
    if (req.query.status) {
      clauses.push('status = ?');
      queryParams.push(String(req.query.status));
    }
    if (req.query.event_type) {
      clauses.push('event_type = ?');
      queryParams.push(String(req.query.event_type));
    }
    if (req.query.search) {
      clauses.push('(phone LIKE ? OR message LIKE ?)');
      queryParams.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }
    const limit = Math.min(Number(req.query.limit || 100), 200);
    let sql = SELECT_SMS;
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    sql += ' ORDER BY id DESC LIMIT ?';
    const rows = all(sql, [...queryParams, limit]);
    const stats = { queued: 0, sent: 0, delivered: 0, failed: 0, simulated: 0 };
    rows.forEach((r) => {
      stats[r.status] = (stats[r.status] || 0) + 1;
      if (r.simulated) stats.simulated += 1;
    });
    res.json({ messages: rows, stats, enabled: smsEnabled() });
  })
);

router.get(
  '/providers',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') throw forbidden();
    res.json({ providers: listSmsProviders() });
  })
);

router.post(
  '/opt-out',
  requireAuth,
  asyncHandler(async (req, res) => {
    const optOut = req.body.opt_out === undefined ? true : Boolean(req.body.opt_out);
    run('UPDATE users SET sms_opt_out = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [
      optOut ? 1 : 0,
      req.user.id,
    ]);
    audit(req, optOut ? 'sms.opt_out' : 'sms.opt_in', 'user', req.user.id);
    res.json({ ok: true, opt_out: optOut });
  })
);

router.post(
  '/flush',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') throw forbidden();
    const sent = await flushSmsQueue(100);
    res.json({ ok: true, sent });
  })
);

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    // 1. Authenticate the sender before touching the database. Fail closed.
    const signature = verifySmsWebhookSignature({
      secret: config.sms.webhookSecret,
      rawBody: req.rawBody,
      headers: req.headers,
      toleranceSeconds: config.sms.webhookToleranceSeconds,
    });
    if (!signature.ok) {
      console.warn('[sms:webhook] rejected', { reason: signature.reason, ip: req.ip });
      throw unauthorized('Invalid webhook signature');
    }

    // 2. Extract and validate the payload.
    const providerMessageId =
      req.body?.provider_message_id || req.body?.message_id || req.body?.id || req.query.message_id;
    if (!providerMessageId) throw badRequest('provider_message_id is required');
    const status = req.body?.status || req.query.status;
    const allowed = ['sent', 'delivered', 'failed'];
    if (!allowed.includes(status)) throw badRequest(`status must be one of: ${allowed.join(', ')}`);

    // 3. Apply the transition (idempotent; final states are immutable).
    const result = markSmsDelivery({ providerMessageId: String(providerMessageId), status });
    res.json({ ok: true, updated: result.updated, reason: result.reason });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = get(`${SELECT_SMS} WHERE id = ?`, [Number(req.params.id)]);
    if (!row) throw notFound('Message not found');
    const { where, params } = scopeFor(req.user);
    const allowed = where
      ? all(`SELECT 1 AS x FROM sms_messages ${where} AND id = ? LIMIT 1`, [...params, row.id]).length > 0
      : true;
    if (!allowed) throw forbidden();
    res.json({ message: row });
  })
);

export default router;
