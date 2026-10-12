import express from 'express';
import { all, get, insert, run } from '../db/index.js';
import { asyncHandler, notFound, forbidden, badRequest, validate, parseJson } from '../utils/helpers.js';
import { requireAuth } from '../middleware/auth.js';
import { audit, notify, unreadCount } from '../services/notify.js';
import { smsEvents } from '../services/sms/events.js';
import { isCaretakerOfProperty } from '../services/rent.js';

const router = express.Router();
router.use(['/notifications', '/messages', '/announcements'], requireAuth);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [req.user.id, limit]);
    res.json({ notifications: rows, unread: unreadCount(req.user.id) });
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ ok: true, unread: 0 });
  })
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const n = get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
    if (!n) throw notFound('Notification not found');
    run('UPDATE notifications SET is_read = 1 WHERE id = ?', [n.id]);
    res.json({ ok: true, unread: unreadCount(req.user.id) });
  })
);

router.delete(
  '/notifications/:id',
  asyncHandler(async (req, res) => {
    const n = get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
    if (!n) throw notFound('Notification not found');
    run('DELETE FROM notifications WHERE id = ?', [n.id]);
    res.json({ ok: true });
  })
);

router.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const box = req.query.box === 'sent' ? 'sent' : 'inbox';
    const rows =
      box === 'sent'
        ? all(
            `SELECT m.*, u.full_name AS counterpart_name, u.avatar_url AS counterpart_avatar, u.role AS counterpart_role
             FROM messages m JOIN users u ON u.id = m.recipient_id
             WHERE m.sender_id = ? ORDER BY m.created_at DESC LIMIT 200`,
            [req.user.id]
          )
        : all(
            `SELECT m.*, u.full_name AS counterpart_name, u.avatar_url AS counterpart_avatar, u.role AS counterpart_role
             FROM messages m JOIN users u ON u.id = m.sender_id
             WHERE m.recipient_id = ? ORDER BY m.created_at DESC LIMIT 200`,
            [req.user.id]
          );
    const unread = get('SELECT COUNT(*) AS c FROM messages WHERE recipient_id = ? AND is_read = 0', [req.user.id]).c;
    res.json({ messages: rows, unread: Number(unread) });
  })
);

router.get(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const m = get(
      `SELECT m.*, s.full_name AS sender_name, s.avatar_url AS sender_avatar, r.full_name AS recipient_name
       FROM messages m JOIN users s ON s.id = m.sender_id JOIN users r ON r.id = m.recipient_id
       WHERE m.id = ?`,
      [Number(req.params.id)]
    );
    if (!m) throw notFound('Message not found');
    if (m.sender_id !== req.user.id && m.recipient_id !== req.user.id) throw forbidden();
    if (m.recipient_id === req.user.id && !m.is_read) {
      run('UPDATE messages SET is_read = 1 WHERE id = ?', [m.id]);
      m.is_read = 1;
    }
    res.json({ message: m });
  })
);

router.post(
  '/messages',
  asyncHandler(async (req, res) => {
    validate(req.body, {
      recipient_id: { required: true, label: 'Recipient', type: 'number' },
      subject: { required: true, label: 'Subject', minLength: 3 },
      body: { required: true, label: 'Message', minLength: 5 },
    });
    const recipient = get('SELECT id, full_name, role, status FROM users WHERE id = ?', [Number(req.body.recipient_id)]);
    if (!recipient) throw notFound('Recipient not found');
    if (recipient.id === req.user.id) throw badRequest('You cannot message yourself');
    const id = insert('INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES (?, ?, ?, ?)', [
      req.user.id,
      recipient.id,
      String(req.body.subject).trim(),
      String(req.body.body).trim(),
    ]);
    notify(recipient.id, {
      type: 'message',
      title: `New message from ${req.user.full_name}`,
      body: String(req.body.subject).trim(),
      link: req.user.role === 'tenant' ? '/tenant/messages' : '/landlord/messages',
      dedupeKey: `msg-${id}`,
    });
    audit(req, 'message.sent', 'message', id, { to: recipient.id });
    res.status(201).json({ ok: true, id });
  })
);

router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const params = [];
    let where = '';
    if (req.user.role === 'landlord') {
      where = 'WHERE a.landlord_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where = 'WHERE a.property_id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)';
      params.push(req.user.id);
    } else if (req.user.role === 'tenant') {
      where = `WHERE a.property_id IN (
        SELECT property_id FROM leases WHERE tenant_id = ? AND status = 'active'
      )`;
      params.push(req.user.id);
    } else if (req.query.property_id) {
      where = 'WHERE a.property_id = ?';
      params.push(Number(req.query.property_id));
    }
    const rows = all(
      `SELECT a.*, p.name AS property_name FROM announcements a LEFT JOIN properties p ON p.id = a.property_id ${where} ORDER BY a.created_at DESC LIMIT 100`,
      params
    );
    res.json({ announcements: rows });
  })
);

router.post(
  '/announcements',
  requireRoleLocal(['landlord', 'admin', 'caretaker']),
  asyncHandler(async (req, res) => {
    validate(req.body, {
      title: { required: true, label: 'Title', minLength: 3 },
      body: { required: true, label: 'Message', minLength: 10 },
      property_id: { required: true, label: 'Property', type: 'number' },
    });
    const property = get('SELECT * FROM properties WHERE id = ?', [Number(req.body.property_id)]);
    if (!property) throw notFound('Property not found');
    if (req.user.role === 'landlord' && property.landlord_id !== req.user.id) throw forbidden();
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, property.id)) throw forbidden();

    const id = insert(
      'INSERT INTO announcements (property_id, landlord_id, title, body, audience) VALUES (?, ?, ?, ?, ?)',
      [
        property.id,
        req.user.role === 'caretaker' ? property.landlord_id : req.user.id,
        String(req.body.title).trim(),
        String(req.body.body).trim(),
        'all',
      ]
    );
    let tenants;
    if (Array.isArray(req.body.tenant_ids) && req.body.tenant_ids.length) {
      const rows = all(
        `SELECT DISTINCT tenant_id FROM leases WHERE property_id = ? AND status = 'active' AND tenant_id IN (${req.body.tenant_ids.map(() => '?').join(',')})`,
        [property.id, ...req.body.tenant_ids.map(Number)]
      );
      tenants = rows;
    } else {
      tenants = all(`SELECT DISTINCT tenant_id FROM leases WHERE property_id = ? AND status = 'active'`, [property.id]);
    }
    tenants.forEach((t) =>
      notify(t.tenant_id, {
        type: 'announcement',
        title: `Announcement: ${req.body.title}`,
        body: String(req.body.body).trim(),
        link: '/tenant/notifications',
        dedupeKey: `ann-${id}`,
      })
    );
    tenants.forEach((t) =>
      smsEvents.announcement({
        userId: t.tenant_id,
        announcementId: id,
        propertyId: property.id,
        title: String(req.body.title).trim(),
      })
    );
    if (req.user.role === 'caretaker') {
      notify(property.landlord_id, {
        type: 'announcement',
        title: `Announcement posted by caretaker ${req.user.full_name}`,
        body: `"${req.body.title}" at ${property.name}.`,
        link: '/landlord/announcements',
        dedupeKey: `ann-notify-${id}`,
      });
    }
    audit(req, 'announcement.created', 'announcement', id, { property_id: property.id }, { property_id: property.id });
    res.status(201).json({ ok: true, id, notified: tenants.length });
  })
);

router.delete(
  '/announcements/:id',
  requireRoleLocal(['landlord', 'admin', 'caretaker']),
  asyncHandler(async (req, res) => {
    const a = get('SELECT * FROM announcements WHERE id = ?', [Number(req.params.id)]);
    if (!a) throw notFound('Announcement not found');
    if (req.user.role === 'landlord' && a.landlord_id !== req.user.id) throw forbidden();
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, a.property_id)) throw forbidden();
    run('DELETE FROM announcements WHERE id = ?', [a.id]);
    audit(req, 'announcement.deleted', 'announcement', a.id, undefined, { property_id: a.property_id });
    res.json({ ok: true });
  })
);

function requireRoleLocal(roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export default router;
