import { insert, all, get } from '../db/index.js';

export function notify(userId, { type = 'info', title, body = '', link = null, dedupeKey = null }) {
  if (!userId || !title) return null;
  if (dedupeKey) {
    const existing = get('SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?', [userId, dedupeKey]);
    if (existing) return existing.id;
  }
  return insert(
    `INSERT INTO notifications (user_id, type, title, body, link, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, title, body, link, dedupeKey]
  );
}

export function notifyMany(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  ids.forEach((id) => notify(id, payload));
}

export function unreadCount(userId) {
  return get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [userId]).c;
}

export function audit(req, action, entity = null, entityId = null, details = null, opts = {}) {
  try {
    insert(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip, property_id, actor_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req?.user?.id ?? null,
        action,
        entity,
        entityId == null ? null : String(entityId),
        details ? JSON.stringify(details) : null,
        req?.ip || req?.headers?.['x-forwarded-for'] || null,
        opts.property_id ?? null,
        req?.user?.role ?? opts.actor_role ?? null,
      ]
    );
  } catch (err) {
    console.error('[audit] failed', err.message);
  }
}

export function auditLog(userId, action, entity = null, entityId = null, details = null, ip = null, propertyId = null, actorRole = null) {
  try {
    insert(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip, property_id, actor_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        action,
        entity,
        entityId == null ? null : String(entityId),
        details ? JSON.stringify(details) : null,
        ip,
        propertyId,
        actorRole,
      ]
    );
  } catch (err) {
    console.error('[audit] failed', err.message);
  }
}

export function propertyTeamIds(propertyId, dbGet = get) {
  const property = dbGet('SELECT landlord_id FROM properties WHERE id = ?', [propertyId]);
  if (!property) return [];
  const helpers = all('SELECT DISTINCT tenant_id FROM leases WHERE property_id = ? AND status = ?', [propertyId, 'active']).map(
    (r) => r.tenant_id
  );
  return [property.landlord_id, ...helpers];
}
