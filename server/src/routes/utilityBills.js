import express from 'express';
import { all, get, insert, run } from '../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden, conflict, validate, normalizePhone } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { getProvider, failPayment } from '../services/payments/index.js';
import '../services/payments/mpesa.js';
import { smsEvents } from '../services/sms/events.js';
import { activeLeaseOfUnit, isCaretakerOfProperty, managedPropertyIds, placeholders } from '../services/rent.js';

const router = express.Router();
router.use(requireAuth);

export const BILL_CATEGORIES = ['Water', 'Electricity', 'Garbage', 'Internet', 'Other'];
const PAY_METHODS = ['cash', 'mpesa', 'bank', 'other'];
const OK_YM = /^\d{4}-(0[1-9]|1[0-2])$/;

const SELECT_BILL = `
  SELECT b.*, p.name AS property_name, p.landlord_id,
         u.unit_number, u.unit_type,
         t.full_name AS tenant_name, t.email AS tenant_email
  FROM utility_bills b
  JOIN properties p ON p.id = b.property_id
  JOIN units u ON u.id = b.unit_id
  JOIN users t ON t.id = b.tenant_id`;

function scopeIds(user) {
  if (user.role === 'tenant') return [];
  return managedPropertyIds(user);
}

function canManage(user, propertyId) {
  if (user.role === 'admin') return true;
  if (user.role === 'landlord') {
    return Boolean(get('SELECT 1 AS x FROM properties WHERE id = ? AND landlord_id = ?', [propertyId, user.id]));
  }
  return isCaretakerOfProperty(user.id, propertyId);
}

function monthLabel(period) {
  const [y, m] = period.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' });
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user.role === 'tenant') {
      const [unpaid, paid] = await Promise.all([
        get(
          `SELECT COALESCE(SUM(amount),0) AS total FROM utility_bills WHERE tenant_id = ? AND status = 'unpaid'`,
          [req.user.id]
        ),
        get(
          `SELECT COALESCE(SUM(amount),0) AS total FROM utility_bills WHERE tenant_id = ? AND status = 'paid'`,
          [req.user.id]
        ),
      ]);
      const bills = all(`${SELECT_BILL} WHERE b.tenant_id = ? ORDER BY b.period DESC, b.id DESC`, [req.user.id]);
      res.json({
        bills,
        stats: { unpaid: Number(unpaid.total || 0), paid: Number(paid.total || 0), payable: bills.filter((b) => b.status === 'unpaid').length },
      });
      return;
    }

    const ids = scopeIds(req.user);
    const ph = placeholders(ids);
    const params = [...ids];
    const where = [`b.property_id IN (${ph})`];

    if (req.query.property_id) {
      const pid = Number(req.query.property_id);
      if (!canManage(req.user, pid)) throw forbidden();
      where.push('b.property_id = ?');
      params.push(pid);
    }
    if (req.query.unit_id) {
      where.push('b.unit_id = ?');
      params.push(Number(req.query.unit_id));
    }
    if (req.query.category) {
      where.push('b.category = ?');
      params.push(String(req.query.category));
    }
    if (req.query.status) {
      where.push('b.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.period) {
      where.push('b.period = ?');
      params.push(String(req.query.period));
    }

    const bills = all(`${SELECT_BILL} WHERE ${where.join(' AND ')} ORDER BY b.period DESC, b.id DESC`, params);
    const totals = get(
      `SELECT COALESCE(SUM(CASE WHEN b.status='unpaid' THEN b.amount ELSE 0 END),0) AS unpaid,
              COALESCE(SUM(CASE WHEN b.status='paid' THEN b.amount ELSE 0 END),0) AS paid
       FROM utility_bills b WHERE ${where.join(' AND ')}`,
      params
    ) || { unpaid: 0, paid: 0 };

    res.json({
      bills,
      stats: {
        unpaid: Number(totals.unpaid || 0),
        paid: Number(totals.paid || 0),
        payable: bills.filter((b) => b.status === 'unpaid').length,
      },
      categories: BILL_CATEGORIES,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const bill = get(`${SELECT_BILL} WHERE b.id = ?`, [Number(req.params.id)]);
    if (!bill) throw notFound('Bill not found');
    if (req.user.role === 'tenant') {
      if (bill.tenant_id !== req.user.id) throw forbidden();
    } else if (!canManage(req.user, bill.property_id)) {
      throw forbidden();
    }
    res.json({ bill });
  })
);

router.post(
  '/',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    const body = validate(req.body, {
      property_id: { required: true, label: 'Property' },
      unit_id: { required: true, label: 'Unit' },
      category: { required: true, label: 'Category' },
      period: { required: true, label: 'Period' },
      amount: { required: true, label: 'Amount' },
    });
    const propertyId = Number(body.property_id);
    if (!canManage(req.user, propertyId)) throw forbidden();

    const category = String(body.category);
    if (!BILL_CATEGORIES.includes(category)) {
      throw badRequest('Unknown bill category', { category: 'Invalid category' });
    }
    const period = String(body.period);
    if (!OK_YM.test(period)) {
      throw badRequest('Period must be a valid YYYY-MM month', { period: 'Invalid period' });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw badRequest('Amount must be a positive number', { amount: 'Positive amount required' });
    }
    const unitId = Number(body.unit_id);
    const unit = get('SELECT id, unit_number, status FROM units WHERE id = ? AND property_id = ?', [unitId, propertyId]);
    if (!unit) throw badRequest('Unit does not belong to this property', { unit_id: 'Invalid unit' });

    const lease = activeLeaseOfUnit(unitId);
    if (!lease) {
      throw badRequest('This unit has no active tenant to bill', { unit_id: 'Unit is vacant' });
    }

    const existing = get('SELECT id FROM utility_bills WHERE unit_id = ? AND period = ? AND category = ?', [
      unitId,
      period,
      category,
    ]);
    if (existing) {
      throw conflict(`A ${category.toLowerCase()} bill for this unit and month already exists`);
    }

    const id = insert(
      `INSERT INTO utility_bills (property_id, unit_id, tenant_id, category, period, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [propertyId, unitId, lease.tenant_id, category, period, amount, req.body.notes ? String(req.body.notes).trim() : null]
    );
    notify(lease.tenant_id, {
      type: 'bill',
      title: `New ${category} bill`,
      body: `${monthLabel(period)} ${category.toLowerCase()} bill of KES ${Number(amount).toLocaleString('en-KE')} for Unit ${unit.unit_number}.`,
      link: '/app/my-bills',
      dedupeKey: `bill-created-${id}`,
    });
    smsEvents.billCreated({
      userId: lease.tenant_id,
      billId: id,
      propertyId,
      category,
      periodLabel: monthLabel(period),
      amount,
    });
    audit(req, 'utility_bill.created', 'utility_bill', id, {
      unit_id: unitId,
      period,
      category,
      amount,
      tenant_id: lease.tenant_id,
    }, { property_id: propertyId });

    const bill = get(`${SELECT_BILL} WHERE b.id = ?`, [id]);
    res.status(201).json({ ok: true, bill });
  })
);

router.patch(
  '/:id',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    const bill = get(`${SELECT_BILL} WHERE b.id = ?`, [Number(req.params.id)]);
    if (!bill) throw notFound('Bill not found');
    if (!canManage(req.user, bill.property_id)) throw forbidden();

    const updates = {};
    if (req.body.category !== undefined) {
      if (!BILL_CATEGORIES.includes(String(req.body.category))) {
        throw badRequest('Unknown bill category', { category: 'Invalid category' });
      }
      updates.category = String(req.body.category);
    }
    if (req.body.period !== undefined) {
      if (!OK_YM.test(String(req.body.period))) {
        throw badRequest('Period must be a valid YYYY-MM month', { period: 'Invalid period' });
      }
      updates.period = String(req.body.period);
    }
    if (req.body.amount !== undefined) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw badRequest('Amount must be a positive number', { amount: 'Positive amount required' });
      }
      updates.amount = amount;
    }
    if (req.body.notes !== undefined) updates.notes = String(req.body.notes).trim() || null;

    if (bill.status === 'paid' && Object.keys(updates).some((k) => k !== 'notes')) {
      throw badRequest('Paid bills cannot be edited. Amount, category and period are locked once paid.');
    }

    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        `UPDATE utility_bills SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [...keys.map((k) => updates[k]), bill.id]
      );
      audit(req, 'utility_bill.updated', 'utility_bill', bill.id, { fields: keys, ...updates }, { property_id: bill.property_id });
    }
    res.json({ ok: true, bill: get(`${SELECT_BILL} WHERE b.id = ?`, [bill.id]) });
  })
);

router.post(
  '/:id/pay-mpesa',
  requireRole('tenant'),
  asyncHandler(async (req, res) => {
    const bill = get(`${SELECT_BILL} WHERE b.id = ?`, [Number(req.params.id)]);
    if (!bill) throw notFound('Bill not found');
    if (bill.tenant_id !== req.user.id) throw forbidden();
    if (bill.status === 'paid') throw badRequest('This bill has already been paid');

    const phone = normalizePhone(req.body.phone || req.user.phone);
    if (!phone) throw badRequest('Enter a valid M-Pesa phone number (07XXXXXXXX)', { phone: 'Invalid Kenyan number' });

    const inFlight = get(
      "SELECT id FROM payments WHERE utility_bill_id = ? AND status IN ('pending','processing')",
      [bill.id]
    );
    if (inFlight) throw conflict('A payment for this bill is already in progress');

    const amount = Number(bill.amount);
    const paymentId = insert(
      `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, utility_bill_id, phone, reference)
       VALUES (?, ?, ?, NULL, ?, ?, 1, 'mpesa', 'mpesa', 'processing', ?, ?, ?)`,
      [
        req.user.id,
        bill.property_id,
        bill.unit_id,
        amount,
        bill.period,
        bill.id,
        phone,
        `BILL-${bill.category}-${bill.period}`,
      ]
    );

    let push;
    try {
      push = await getProvider('mpesa').stkPush({
        phone,
        amount,
        reference: `${bill.category} ${bill.period}`,
        accountRef: `SR${bill.unit_number}${req.user.id}`,
      });
    } catch (err) {
      failPayment(paymentId, err.message);
      throw badRequest(err.message);
    }

    run('UPDATE payments SET provider_ref = ?, merchant_request_id = ? WHERE id = ?', [
      push.checkoutRequestId,
      push.merchantRequestId || null,
      paymentId,
    ]);
    audit(req, 'utility_bill.pay_initiated', 'utility_bill', bill.id, { amount, phone, payment_id: paymentId }, { property_id: bill.property_id });

    res.status(201).json({
      payment_id: paymentId,
      message: push.customerMessage,
      amount,
      checkout_request_id: push.checkoutRequestId,
    });
  })
);

router.post(
  '/:id/pay',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    const bill = get(`${SELECT_BILL} WHERE b.id = ?`, [Number(req.params.id)]);
    if (!bill) throw notFound('Bill not found');
    if (!canManage(req.user, bill.property_id)) throw forbidden();
    if (bill.status === 'paid') throw badRequest('This bill has already been paid');

    const method = req.body.method ? String(req.body.method) : 'cash';
    if (!PAY_METHODS.includes(method)) {
      throw badRequest('Unknown payment method', { method: 'Invalid method' });
    }

    run(
      `UPDATE utility_bills SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         payment_method = ?, payment_reference = ?, paid_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
      [
        method,
        req.body.reference ? String(req.body.reference).trim() : null,
        req.user.id,
        bill.id,
      ]
    );
    notify(bill.tenant_id, {
      type: 'bill',
      title: 'Bill paid',
      body: `Your ${monthLabel(bill.period)} ${String(bill.category).toLowerCase()} bill of KES ${Number(bill.amount).toLocaleString('en-KE')} for Unit ${bill.unit_number} has been settled.`,
      link: '/app/my-bills',
      dedupeKey: `bill-paid-${bill.id}`,
    });
    smsEvents.billPaid({
      userId: bill.tenant_id,
      billId: bill.id,
      propertyId: bill.property_id,
      category: bill.category,
      periodLabel: monthLabel(bill.period),
      amount: bill.amount,
    });
    audit(req, 'utility_bill.paid', 'utility_bill', bill.id, {
      method,
      reference: req.body.reference || null,
      amount: bill.amount,
      period: bill.period,
    }, { property_id: bill.property_id });

    res.json({ ok: true, bill: get(`${SELECT_BILL} WHERE b.id = ?`, [bill.id]) });
  })
);

router.delete(
  '/:id',
  requireRole('landlord', 'admin', 'caretaker'),
  asyncHandler(async (req, res) => {
    const bill = get(`${SELECT_BILL} WHERE b.id = ?`, [Number(req.params.id)]);
    if (!bill) throw notFound('Bill not found');
    if (!canManage(req.user, bill.property_id)) throw forbidden();
    if (bill.status === 'paid') throw badRequest('Paid bills cannot be deleted');
    run('DELETE FROM utility_bills WHERE id = ?', [bill.id]);
    audit(req, 'utility_bill.deleted', 'utility_bill', bill.id, { period: bill.period, category: bill.category }, { property_id: bill.property_id });
    res.json({ ok: true });
  })
);

export default router;