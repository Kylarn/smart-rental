import express from 'express';
import { all, get, insert, run, tx } from '../db/index.js';
import { asyncHandler, notFound, forbidden, badRequest, validate, normalizePhone } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { getProvider, completePayment, failPayment, listProviders, nextReceiptNumber } from '../services/payments/index.js';
import '../services/payments/mpesa.js';
import { activeLeaseOfTenant, leaseArrears, landlordStats, placeholders, isCaretakerOfProperty } from '../services/rent.js';

const router = express.Router();

router.post(
  '/mpesa/callback',
  asyncHandler(async (req, res) => {
    const mpesa = (await import('../services/payments/mpesa.js')).default;
    const result = mpesa.handleCallback(req.body);
    res.json({
      ResultCode: 0,
      ResultDesc: result ? 'Accepted' : 'Ignored',
    });
  })
);

router.use(requireAuth);

const SELECT_PAYMENT = `
  SELECT pay.*, t.full_name AS tenant_name, t.email AS tenant_email,
         p.name AS property_name, u.unit_number, u.unit_type,
         l.rent AS lease_rent
  FROM payments pay
  JOIN users t ON t.id = pay.tenant_id
  LEFT JOIN properties p ON p.id = pay.property_id
  LEFT JOIN units u ON u.id = pay.unit_id
  LEFT JOIN leases l ON l.id = pay.lease_id`;

function canAccess(user, payment) {
  if (user.role === 'admin') return true;
  if (user.role === 'tenant') return payment.tenant_id === user.id;
  if (user.role === 'caretaker') {
    return payment.property_id ? isCaretakerOfProperty(user.id, payment.property_id) : false;
  }
  if (user.role === 'landlord') {
    if (payment.property_id) {
      const prop = get('SELECT landlord_id FROM properties WHERE id = ?', [payment.property_id]);
      if (prop?.landlord_id === user.id) return true;
    }
    return get(
      `SELECT 1 AS x FROM leases l JOIN properties p ON p.id = l.property_id
       WHERE l.id = ? AND p.landlord_id = ?`,
      [payment.lease_id, user.id]
    );
  }
  return false;
}

router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json({ providers: listProviders() });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = [];
    const where = [];
    if (req.user.role === 'tenant') {
      where.push('pay.tenant_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'caretaker') {
      where.push('pay.property_id IN (SELECT property_id FROM property_caretakers WHERE caretaker_id = ?)');
      params.push(req.user.id);
    } else if (req.user.role === 'landlord') {
      where.push('p.landlord_id = ?');
      params.push(req.user.id);
    }
    ['status', 'method', 'period'].forEach((f) => {
      if (req.query[f]) {
        where.push(`pay.${f} = ?`);
        params.push(req.query[f]);
      }
    });
    if (req.query.property_id) {
      where.push('pay.property_id = ?');
      params.push(Number(req.query.property_id));
    }
    if (req.query.search) {
      where.push('(t.full_name LIKE ? OR pay.receipt_number LIKE ? OR u.unit_number LIKE ?)');
      params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
    }
    let sql = SELECT_PAYMENT;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY pay.created_at DESC LIMIT 500';
    const rows = all(sql, params);

    let stats = null;
    if (req.user.role !== 'tenant') {
      const completed = rows.filter((r) => r.status === 'completed');
      stats = {
        total: rows.length,
        completed: completed.length,
        pending: rows.filter((r) => ['pending', 'processing'].includes(r.status)).length,
        failed: rows.filter((r) => r.status === 'failed').length,
        amount: completed.reduce((s, r) => s + Number(r.amount), 0),
      };
    } else {
      const lease = activeLeaseOfTenant(req.user.id);
      stats = {
        arrears: lease ? leaseArrears(lease).total : 0,
        lease_rent: lease?.rent || 0,
        total_paid: rows.filter((r) => r.status === 'completed').reduce((s, r) => s + Number(r.amount), 0),
      };
    }
    res.json({ payments: rows, stats });
  })
);

router.get(
  '/summary',
  requireRole('landlord', 'admin'),
  asyncHandler(async (req, res) => {
    if (req.user.role === 'admin') {
      const totals = get(
        `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN amount END),0) AS collected,
                COALESCE(SUM(CASE WHEN status IN ('pending','processing') THEN amount END),0) AS pending,
                COUNT(*) AS count FROM payments`
      );
      const unitRow = get(
        `SELECT COUNT(*) AS units, COALESCE(SUM(CASE WHEN status='occupied' THEN 1 ELSE 0 END),0) AS occupied FROM units`
      );
      return res.json({
        stats: {
          collected: Number(totals.collected),
          pendingAmount: Number(totals.pending),
          count: Number(totals.count),
          units: Number(unitRow.units),
          occupied: Number(unitRow.occupied),
        },
      });
    }
    res.json({ stats: landlordStats(req.user.id) });
  })
);

router.post(
  '/initiate',
  requireRole('tenant'),
  asyncHandler(async (req, res) => {
    const lease = activeLeaseOfTenant(req.user.id);
    if (!lease) throw badRequest('You do not have an active lease yet');

    const phone = normalizePhone(req.body.phone || req.user.phone);
    if (!phone) throw badRequest('Enter a valid M-Pesa phone number (07XXXXXXXX)', { phone: 'Invalid Kenyan number' });

    const months = Math.max(1, Math.min(12, Number(req.body.months_covered || 1)));
    const amount = req.body.amount ? Number(req.body.amount) : Number(lease.rent) * months;
    if (!amount || amount < 1) throw badRequest('Enter a valid payment amount', { amount: 'Must be at least KES 1' });

    const arrears = leaseArrears(lease);
    const period = req.body.period || arrears.unpaidPeriods[0] || new Date().toISOString().slice(0, 7);

    const paymentId = insert(
      `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, phone, reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'mpesa', 'mpesa', 'processing', ?, ?)`,
      [
        req.user.id,
        lease.property_id,
        lease.unit_id,
        lease.id,
        amount,
        period,
        months,
        phone,
        `RENT-${period}-${lease.id}`,
      ]
    );

    let push;
    try {
      push = await getProvider('mpesa').stkPush({
        phone,
        amount,
        reference: `Rent ${period}`,
        accountRef: `SR${lease.unit_number}${lease.tenant_id}`,
      });
    } catch (err) {
      failPayment(paymentId, err.message);
      throw badRequest(err.message);
    }

    run('UPDATE payments SET provider_ref = ? WHERE id = ?', [push.checkoutRequestId, paymentId]);
    audit(req, 'payment.initiated', 'payment', paymentId, { amount, phone, provider: 'mpesa' }, { property_id: lease.property_id });

    res.status(201).json({
      payment_id: paymentId,
      message: push.customerMessage,
      amount,
      period,
      checkout_request_id: push.checkoutRequestId,
    });
  })
);

router.get(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const payment = get('SELECT * FROM payments WHERE id = ?', [Number(req.params.id)]);
    if (!payment) throw notFound('Payment not found');
    if (!canAccess(req.user, payment)) throw forbidden();
    res.json({
      id: payment.id,
      status: payment.status,
      receipt_number: payment.receipt_number,
      failure_reason: payment.failure_reason,
      amount: payment.amount,
      period: payment.period,
      paid_at: payment.paid_at,
    });
  })
);

router.get(
  '/:id/receipt',
  asyncHandler(async (req, res) => {
    const payment = get(`${SELECT_PAYMENT} WHERE pay.id = ?`, [Number(req.params.id)]);
    if (!payment) throw notFound('Payment not found');
    if (!canAccess(req.user, payment)) throw forbidden();
    if (payment.status !== 'completed') throw badRequest('A receipt is only available for completed payments');
    const property = payment.property_id ? get('SELECT * FROM properties WHERE id = ?', [payment.property_id]) : null;
    const landlord = property ? get('SELECT full_name, email, phone FROM users WHERE id = ?', [property.landlord_id]) : null;
    res.json({ receipt: { ...payment, property, landlord } });
  })
);

router.post(
  '/record',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    validate(req.body, {
      tenant_id: { required: true, label: 'Tenant', type: 'number' },
      amount: { required: true, label: 'Amount', type: 'number', min: 1 },
      method: { required: true, label: 'Payment method' },
    });
    const lease = get(
      `SELECT l.*, p.landlord_id FROM leases l JOIN properties p ON p.id = l.property_id
       WHERE l.tenant_id = ? AND l.status = 'active'`,
      [Number(req.body.tenant_id)]
    );
    if (!lease) throw badRequest('That tenant has no active lease', { tenant_id: 'No active lease' });
    if (req.user.role === 'landlord' && lease.landlord_id !== req.user.id) throw forbidden();
    if (req.user.role === 'caretaker' && !isCaretakerOfProperty(req.user.id, lease.property_id)) throw forbidden();

    const PAYMENT_METHODS = ['mpesa', 'bank', 'cash', 'card'];
    if (!PAYMENT_METHODS.includes(req.body.method)) {
      throw badRequest('Invalid payment method', { method: `One of: ${PAYMENT_METHODS.join(', ')}` });
    }

    const arrears = leaseArrears(lease);
    const period = req.body.period || arrears.unpaidPeriods[0] || new Date().toISOString().slice(0, 7);
    const recordId = tx(() => {
      const paymentId = insert(
        `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, phone, reference, recorded_by, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        [
          lease.tenant_id,
          lease.property_id,
          lease.unit_id,
          lease.id,
          Number(req.body.amount),
          period,
          Number(req.body.months_covered || 1),
          req.body.method,
          req.body.method,
          req.body.phone || null,
          req.body.reference || null,
          req.user.id,
          req.body.paid_at || new Date().toISOString(),
        ]
      );
      const receipt = nextReceiptNumber();
      run('UPDATE payments SET receipt_number = ? WHERE id = ?', [receipt, paymentId]);
      completePayment(paymentId);
      return paymentId;
    });
    audit(req, 'payment.recorded', 'payment', recordId, { amount: req.body.amount, method: req.body.method }, { property_id: lease.property_id });
    res.status(201).json({ ok: true, payment_id: recordId, receipt: get('SELECT receipt_number FROM payments WHERE id = ?', [recordId])?.receipt_number });
  })
);

router.patch(
  '/:id/cancel',
  requireRole('tenant'),
  asyncHandler(async (req, res) => {
    const payment = get('SELECT * FROM payments WHERE id = ?', [Number(req.params.id)]);
    if (!payment || payment.tenant_id !== req.user.id) throw notFound('Payment not found');
    if (!['pending', 'processing'].includes(payment.status)) throw badRequest('This payment can no longer be cancelled');
    failPayment(payment.id, 'Cancelled by tenant');
    res.json({ ok: true });
  })
);

export default router;
