import { all, get, insert, run } from '../../db/index.js';
import { config } from '../../config.js';
import { normalizePhone } from '../../utils/helpers.js';
import { mockProvider } from './providers/mock.js';
import { createHttpProvider } from './providers/http.js';

const providers = new Map();

export function registerSmsProvider(provider) {
  if (provider && provider.name) providers.set(provider.name, provider);
}

registerSmsProvider(mockProvider);
registerSmsProvider(createHttpProvider());

export function getSmsProvider(name = activeProviderName()) {
  return providers.get(name) || providers.get('mock');
}

function settingProvider() {
  const row = get('SELECT value FROM settings WHERE key = ?', ['sms_provider']);
  const value = row && String(row.value).trim();
  return value ? value : null;
}

export function activeProviderName() {
  return settingProvider() || config.sms.provider;
}

export function listSmsProviders() {
  const active = activeProviderName();
  return [...providers.values()].map((p) => ({
    name: p.name,
    label: p.label,
    ready: p.isReady ? p.isReady() : true,
    active: p.name === active,
  }));
}

function settingEnabled() {
  const row = get('SELECT value FROM settings WHERE key = ?', ['sms_enabled']);
  return !row || String(row.value) !== 'false';
}

export function smsEnabled() {
  if (!config.sms.enabled) return false;
  if (activeProviderName() === 'disabled') return false;
  return settingEnabled();
}

function queueSms({ userId, phone, message, eventType, propertyId, relatedEntity, relatedId, dedupeKey }) {
  if (dedupeKey) {
    const existing = get('SELECT id FROM sms_messages WHERE dedupe_key = ?', [dedupeKey]);
    if (existing) return null;
  }
  const id = insert(
    `INSERT INTO sms_messages (user_id, property_id, phone, message, event_type, related_entity, related_id, status, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    [
      userId ?? null,
      propertyId ?? null,
      phone,
      message,
      eventType || 'general',
      relatedEntity ?? null,
      relatedId == null ? null : String(relatedId),
      dedupeKey ?? null,
    ]
  );
  setImmediate(() => {
    flushSmsQueue().catch((err) => console.error('[sms] flush failed', err.message));
  });
  return id;
}

export function dispatchSms(eventType, opts = {}) {
  const { userId = null, to = null, message, propertyId = null, relatedEntity = null, relatedId = null, dedupeKey = null, force = false } = opts;
  if (!smsEnabled() || !message) return null;
  let phone = to;
  if (userId) {
    const user = get('SELECT id, phone, sms_opt_out FROM users WHERE id = ?', [userId]);
    if (!user) return null;
    if (user.sms_opt_out && !force) return null;
    if (!phone) phone = user.phone;
  }
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return queueSms({ userId, phone: normalized, message, eventType, propertyId, relatedEntity, relatedId, dedupeKey });
}

let flushing = false;

export async function flushSmsQueue(limit = 25) {
  if (flushing || !smsEnabled()) return 0;
  flushing = true;
  try {
    const provider = getSmsProvider();
    const rows = all(
      `SELECT * FROM sms_messages
       WHERE status = 'queued' OR (status = 'failed' AND attempts < ?)
       ORDER BY id LIMIT ?`,
      [config.sms.maxAttempts, limit]
    );
    let sent = 0;
    for (const row of rows) {
      try {
        const result = await provider.send({ to: row.phone, message: row.message, senderId: config.sms.senderId });
        run(
          `UPDATE sms_messages SET status = 'sent', provider = ?, provider_message_id = ?, simulated = ?,
             attempts = attempts + 1, error = NULL, sent_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`,
          [provider.name, result.id || null, result.simulated ? 1 : 0, new Date().toISOString(), row.id]
        );
        sent += 1;
      } catch (err) {
        run(
          `UPDATE sms_messages SET status = 'failed', provider = ?, attempts = attempts + 1, error = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`,
          [provider.name, String(err.message || err).slice(0, 300), row.id]
        );
      }
    }
    return sent;
  } finally {
    flushing = false;
  }
}

const FINAL_SMS_STATUSES = new Set(['delivered', 'failed']);
const ALLOWED_SMS_STATUSES = new Set(['queued', 'sent', 'delivered', 'failed']);

export function markSmsDelivery({ providerMessageId, status }) {
  if (!providerMessageId) return { updated: false, reason: 'missing_provider_id' };
  if (!ALLOWED_SMS_STATUSES.has(status)) return { updated: false, reason: 'invalid_status' };
  const row = get('SELECT id, status FROM sms_messages WHERE provider_message_id = ?', [String(providerMessageId)]);
  if (!row) return { updated: false, reason: 'unknown_message' };
  // Never let a later webhook overwrite a final delivery state.
  if (FINAL_SMS_STATUSES.has(row.status)) return { updated: false, reason: 'already_final' };
  if (row.status === status) return { updated: false, reason: 'no_change' };
  run(
    `UPDATE sms_messages SET status = ?, delivered_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [status, status === 'delivered' ? new Date().toISOString() : null, row.id]
  );
  return { updated: true, reason: 'ok', id: row.id, status };
}
