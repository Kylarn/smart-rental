import crypto from 'node:crypto';
import { get, insert, run } from '../db/index.js';
import { config } from '../config.js';

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function createActivationToken({ userId, purpose = 'activation', propertyId = null, createdBy = null, ttlHours = config.activationTtlHours } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + Math.max(1, ttlHours) * 3600 * 1000).toISOString();
  run(
    `UPDATE account_activations SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    [userId, purpose]
  );
  insert(
    `INSERT INTO account_activations (user_id, token_hash, purpose, property_id, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, hashToken(token), purpose, propertyId, createdBy, expiresAt]
  );
  const base = String(config.publicBaseUrl || '').replace(/\/$/, '');
  return { token, expiresAt, url: `${base}/activate?token=${encodeURIComponent(token)}` };
}

export function findActivation(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  return get('SELECT * FROM account_activations WHERE token_hash = ?', [hashToken(token)]);
}

export function activationStatus(row) {
  if (!row) return 'invalid';
  if (row.used_at) return 'used';
  if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
  return 'valid';
}

export function consumeActivation(id) {
  run(
    `UPDATE account_activations SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [id]
  );
}

export function pendingActivationFor(userId, purpose = 'activation') {
  return get(
    `SELECT * FROM account_activations
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     ORDER BY id DESC LIMIT 1`,
    [userId, purpose]
  );
}
