import express from 'express';
import { all, get, insert } from '../db/index.js';
import { asyncHandler, validate, notFound, badRequest, normalizePhone } from '../utils/helpers.js';
import { optionalAuth } from '../middleware/auth.js';
import { rateLimit, envMax } from '../middleware/rateLimit.js';
import { notify, notifyMany, audit } from '../services/notify.js';
import { smsEvents } from '../services/sms/events.js';
import { parseJson } from '../utils/helpers.js';

const router = express.Router();

const publicApplyLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: envMax('RATE_LIMIT_PUBLIC_APPLY_MAX', 20),
  keyPrefix: 'public-apply',
});

function applicationReference(id) {
  return `APP-${String(id).padStart(6, '0')}`;
}

function decorate(p) {
  return {
    ...p,
    amenities: parseJson(p.amenities, []),
    images: parseJson(p.images, []),
    landlord_name: p.landlord_name ? String(p.landlord_name).replace(/\b\w/g, (c) => c.toUpperCase()) : null,
  };
}

router.get(
  '/counties',
  asyncHandler(async (_req, res) => {
    const rows = all(
      `SELECT county, COUNT(*) AS properties FROM properties WHERE status = 'active' GROUP BY county ORDER BY properties DESC`
    );
    res.json({ counties: rows });
  })
);

router.get(
  '/properties',
  asyncHandler(async (req, res) => {
    const { search, county, type, minPrice, maxPrice, bedrooms, sort = 'newest' } = req.query;
    let rows = all(
      `SELECT p.*, u.full_name AS landlord_name, u.phone AS landlord_phone,
              (SELECT MIN(rent) FROM units WHERE property_id = p.id AND status = 'vacant' AND occupancy_known = 1) AS min_rent,
              (SELECT MAX(rent) FROM units WHERE property_id = p.id AND status = 'vacant' AND occupancy_known = 1) AS max_rent,
              (SELECT COUNT(*) FROM units WHERE property_id = p.id AND status = 'vacant' AND occupancy_known = 1) AS available_units,
              (SELECT COUNT(*) FROM units WHERE property_id = p.id) AS total_units
       FROM properties p
       JOIN users u ON u.id = p.landlord_id
       WHERE p.status = 'active'`
    );

    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.area || '').toLowerCase().includes(q) ||
          (p.county || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
      );
    }
    if (county) rows = rows.filter((p) => p.county === county);
    if (type) rows = rows.filter((p) => p.property_type === type);
    if (minPrice) rows = rows.filter((p) => Number(p.max_rent || p.min_rent || 0) >= Number(minPrice));
    if (maxPrice) rows = rows.filter((p) => Number(p.min_rent || p.max_rent || 0) <= Number(maxPrice));
    if (bedrooms) {
      const n = Number(bedrooms);
      rows = rows.filter((p) => {
        const units = all('SELECT bedrooms, status, occupancy_known FROM units WHERE property_id = ?', [p.id]).filter(
          (u) => u.status === 'vacant' && u.occupancy_known !== 0
        );
        if (!units.length) return false;
        return n >= 3 ? units.some((u) => u.bedrooms >= 3) : units.some((u) => u.bedrooms === n);
      });
    }

    if (sort === 'price_asc') rows.sort((a, b) => (a.min_rent ?? 1e12) - (b.min_rent ?? 1e12));
    else if (sort === 'price_desc') rows.sort((a, b) => (b.min_rent ?? 0) - (a.min_rent ?? 0));
    else rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ properties: rows.map(decorate), total: rows.length });
  })
);

router.get(
  '/properties/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const property = get(
      `SELECT p.*, u.full_name AS landlord_name, u.phone AS landlord_phone, u.avatar_url AS landlord_avatar
       FROM properties p JOIN users u ON u.id = p.landlord_id
       WHERE p.id = ? AND p.status = 'active'`,
      [id]
    );
    if (!property) throw notFound('Property not found');
    const units = all(
      `SELECT id, unit_number, floor, unit_type, bedrooms, rent, deposit, size_sqm, description, status, amenities
       FROM units
       WHERE property_id = ? AND status = 'vacant' AND COALESCE(occupancy_known, 1) = 1
       ORDER BY CAST(unit_number AS INTEGER), unit_number`,
      [id]
    );
    const applications = req.user
      ? all('SELECT * FROM applications WHERE property_id = ? AND applicant_id = ?', [id, req.user.id])
      : [];
    const unitTypes = [...new Set(units.map((u) => u.unit_type))];

    res.json({
      property: decorate(property),
      units: units.map((u) => ({ ...u, amenities: parseJson(u.amenities, []) })),
      unitTypes,
      myApplications: applications,
      landlord: {
        id: property.landlord_id,
        name: property.landlord_name,
        phone: property.landlord_phone,
        avatar: property.landlord_avatar,
      },
    });
  })
);

router.post(
  '/properties/:id/apply',
  publicApplyLimit,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const property = get(`SELECT * FROM properties WHERE id = ? AND status = 'active'`, [id]);
    if (!property) throw notFound('Property not found');

    validate(req.body, {
      full_name: { required: true, label: 'Full name', minLength: 3 },
      email: { required: true, label: 'Email', type: 'email' },
      phone: { required: true, label: 'Phone', type: 'phone' },
      move_in_date: { required: true, label: 'Preferred move-in date' },
    });

    let unitId = req.body.unit_id ? Number(req.body.unit_id) : null;
    if (unitId) {
      const unit = get('SELECT id, status, occupancy_known FROM units WHERE id = ? AND property_id = ?', [unitId, id]);
      if (!unit) throw badRequest('Selected unit is not available on this property', { unit_id: 'Invalid unit' });
      if (unit.status !== 'vacant' || unit.occupancy_known === 0)
        throw badRequest('Selected unit is no longer vacant', { unit_id: 'Unit is occupied' });
    }

    const applicantId = req.user?.id || null;
    const email = String(req.body.email).trim().toLowerCase();
    const phone = normalizePhone(req.body.phone);
    if (applicantId) {
      const existing = get(
        `SELECT id FROM applications WHERE applicant_id = ? AND property_id = ? AND status IN ('pending','under_review','info_requested','approved')`,
        [applicantId, id]
      );
      if (existing) throw badRequest('You already have an active application for this property');
    } else {
      const existing = get(
        `SELECT id FROM applications WHERE property_id = ? AND status IN ('pending','under_review','info_requested','approved')
         AND (lower(email) = ? OR phone = ?) ORDER BY id DESC LIMIT 1`,
        [id, email, phone]
      );
      if (existing) throw badRequest('An application for this property already exists for these contact details');
    }

    const applicationId = insert(
      `INSERT INTO applications (property_id, unit_id, applicant_id, full_name, email, phone, move_in_date, occupants, message, documents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        unitId,
        applicantId,
        String(req.body.full_name).trim(),
        email,
        phone,
        req.body.move_in_date,
        Number(req.body.occupants || 1),
        req.body.message || '',
        JSON.stringify(req.body.documents || []),
      ]
    );

    notify(property.landlord_id, {
      type: 'application',
      title: 'New rental application',
      body: `${req.body.full_name} applied to rent at ${property.name}.`,
      link: '/landlord/applications',
      dedupeKey: `application-${applicationId}`,
    });
    const caretakers = all('SELECT caretaker_id FROM property_caretakers WHERE property_id = ?', [id]);
    notifyMany(caretakers.map((c) => c.caretaker_id), {
      type: 'application',
      title: 'New rental application',
      body: `${req.body.full_name} applied to rent at ${property.name}.`,
      link: '/caretaker/applications',
      dedupeKey: `application-caretaker-${applicationId}`,
    });
    if (applicantId) {
      notify(applicantId, {
        type: 'application',
        title: 'Application submitted',
        body: `Your application for ${property.name} has been received and is pending review.`,
        link: '/tenant/applications',
        dedupeKey: `application-tenant-${applicationId}`,
      });
    }
    audit(req, 'application.created', 'application', applicationId, { property_id: id, anonymous: !applicantId });

    res.status(201).json({
      ok: true,
      message: 'Application submitted successfully! The property manager will review it shortly.',
      applicationId,
      reference: applicationReference(applicationId),
    });
  })
);

router.get(
  '/applications/status',
  asyncHandler(async (req, res) => {
    const reference = String(req.query.reference || '').trim().toUpperCase();
    const email = String(req.query.email || '').trim().toLowerCase();
    const match = /^APP-(\d+)$/.exec(reference);
    if (!match || !email) {
      throw badRequest('Provide your application reference and the email you applied with');
    }
    const app = get(
      `SELECT a.id, a.status, a.created_at, a.updated_at, a.reviewer_notes, p.name AS property_name
       FROM applications a JOIN properties p ON p.id = a.property_id
       WHERE a.id = ? AND lower(a.email) = ?`,
      [Number(match[1]), email]
    );
    if (!app) throw notFound('No application matches those details');
    res.json({
      reference,
      status: app.status,
      property_name: app.property_name,
      submitted_at: app.created_at,
      updated_at: app.updated_at,
      message: app.reviewer_notes || null,
    });
  })
);

router.post(
  '/properties/:id/contact',
  publicApplyLimit,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const property = get('SELECT * FROM properties WHERE id = ?', [id]);
    if (!property) throw notFound('Property not found');
    validate(req.body, {
      name: { required: true, label: 'Your name' },
      email: { required: true, label: 'Email', type: 'email' },
      phone: { required: true, label: 'Phone', type: 'phone' },
      message: { required: true, label: 'Message', minLength: 10 },
    });
    const senderId = req.user?.id;
    const email = String(req.body.email).trim().toLowerCase();
    const phone = normalizePhone(req.body.phone);
    if (senderId) {
      const messageId = insert(
        `INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES (?, ?, ?, ?)`,
        [senderId, property.landlord_id, `Enquiry about ${property.name}`, String(req.body.message).trim()]
      );
      notify(property.landlord_id, {
        type: 'message',
        title: 'New property enquiry',
        body: `${String(req.body.name).trim()} sent a message about ${property.name}.`,
        link: '/landlord/messages',
        dedupeKey: `msg-${messageId}`,
      });
      audit(req, 'message.sent', 'message', messageId, { to: property.landlord_id }, { property_id: id });
    } else {
      notify(property.landlord_id, {
        type: 'message',
        title: 'New property enquiry',
        body: `${String(req.body.name).trim()} (${email}, ${phone}) sent a message about ${property.name}: ${String(req.body.message).trim()}`,
        link: '/landlord/messages',
      });
      audit(req, 'enquiry.created', 'property', id, { type: 'contact', name: String(req.body.name).trim(), email, phone }, { property_id: id });
    }
    res.status(201).json({ ok: true, message: 'Your message has been sent to the landlord.' });
  })
);

router.post(
  '/properties/:id/viewing',
  publicApplyLimit,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const property = get('SELECT * FROM properties WHERE id = ?', [id]);
    if (!property) throw notFound('Property not found');
    validate(req.body, {
      name: { required: true, label: 'Your name' },
      phone: { required: true, label: 'Phone', type: 'phone' },
      viewing_date: { required: true, label: 'Preferred viewing date' },
    });
    const senderId = req.user?.id;
    const note = `Preferred date: ${req.body.viewing_date}\n\n${req.body.message || ''}`.trim();
    if (senderId) {
      const messageId = insert(`INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES (?, ?, ?, ?)`, [
        senderId,
        property.landlord_id,
        `Viewing request for ${property.name}`,
        note,
      ]);
      notify(property.landlord_id, {
        type: 'application',
        title: 'New viewing request',
        body: `${String(req.body.name).trim()} would like to view ${property.name} on ${req.body.viewing_date}.`,
        link: '/landlord/messages',
        dedupeKey: `viewing-${messageId}`,
      });
      audit(req, 'message.sent', 'message', messageId, { to: property.landlord_id }, { property_id: id });
    } else {
      const phone = normalizePhone(req.body.phone);
      const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
      notify(property.landlord_id, {
        type: 'application',
        title: 'New viewing request',
        body: `${String(req.body.name).trim()} (${phone}${email ? `, ${email}` : ''}) would like to view ${property.name} on ${req.body.viewing_date}.`,
        link: '/landlord/messages',
      });
      audit(req, 'enquiry.created', 'property', id, { type: 'viewing', name: String(req.body.name).trim(), phone, email, viewing_date: req.body.viewing_date }, { property_id: id });
    }
    res.status(201).json({ ok: true, message: 'Viewing request sent! The landlord will confirm shortly.' });
  })
);

export default router;
