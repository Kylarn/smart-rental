import express from 'express';
import { all, get, insert, run } from '../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../utils/helpers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit, notify } from '../services/notify.js';
import { caretakerPropertyIds, isCaretakerOfProperty, landlordPropertyIds, placeholders } from '../services/rent.js';

const router = express.Router();
router.use(requireAuth, requireRole('landlord', 'admin', 'caretaker'));

const CATEGORIES = ['Maintenance', 'Repairs', 'Utilities', 'Salaries', 'Insurance', 'Taxes', 'Marketing', 'Supplies', 'Furniture & Appliances', 'Other'];

const SELECT_EXPENSE = `
  SELECT e.*, p.name AS property_name,
         u.unit_number, uf.full_name AS created_by_name
  FROM expenses e
  JOIN properties p ON p.id = e.property_id
  LEFT JOIN units u ON u.id = e.unit_id
  LEFT JOIN users uf ON uf.id = e.created_by`;

function scopePropertyIds(user) {
  if (user.role === 'admin') return all('SELECT id FROM properties').map((r) => r.id);
  if (user.role === 'caretaker') return caretakerPropertyIds(user.id);
  return landlordPropertyIds(user.id);
}

function canManage(user, propertyId) {
  if (user.role === 'admin') return true;
  if (user.role === 'landlord') {
    return Boolean(get('SELECT 1 AS x FROM properties WHERE id = ? AND landlord_id = ?', [propertyId, user.id]));
  }
  return isCaretakerOfProperty(user.id, propertyId);
}

function okDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function clean(input, base = {}) {
  const has = (v) => v !== undefined && v !== null && v !== '';
  const now = new Date().toISOString().slice(0, 10);
  return {
    property_id: has(input.property_id) ? Number(input.property_id) : base.property_id,
    unit_id: has(input.unit_id) ? Number(input.unit_id) : base.unit_id || null,
    category: has(input.category) ? String(input.category) : base.category || 'Other',
    description: has(input.description) ? String(input.description).trim() : base.description,
    amount: has(input.amount) ? Number(input.amount) : base.amount,
    expense_date: has(input.expense_date) ? String(input.expense_date) : base.expense_date || now,
    vendor: has(input.vendor) ? String(input.vendor).trim() : base.vendor || null,
    receipt_url: has(input.receipt_url) ? String(input.receipt_url).trim() : base.receipt_url || null,
    notes: has(input.notes) ? String(input.notes).trim() : base.notes || null,
  };
}

function validateExpense(value) {
  if (!value.property_id) throw badRequest('Property is required', { property_id: 'Required' });
  if (!value.description) throw badRequest('Description is required', { description: 'Required' });
  if (!Number.isFinite(value.amount) || value.amount <= 0) {
    throw badRequest('Amount must be a positive number', { amount: 'Positive amount required' });
  }
  if (!okDate(value.expense_date)) {
    throw badRequest('Expense date must be a valid YYYY-MM-DD date', { expense_date: 'Invalid date' });
  }
  if (value.expense_date > new Date().toISOString().slice(0, 10)) {
    throw badRequest('Expense date cannot be in the future', { expense_date: 'Future date' });
  }
  if (value.category && !CATEGORIES.includes(value.category)) {
    throw badRequest('Unknown expense category', { category: 'Invalid category' });
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ids = scopePropertyIds(req.user);
    const ph = placeholders(ids);
    const params = ids.length ? [...ids] : [-1];
    const where = [`e.property_id IN (${ph})`];
    if (req.query.property_id) {
      const pid = Number(req.query.property_id);
      if (!canManage(req.user, pid)) throw forbidden();
      where.push('e.property_id = ?');
      params.push(pid);
    }
    if (req.query.category) {
      where.push('e.category = ?');
      params.push(String(req.query.category));
    }
    if (req.query.from) {
      where.push("date(e.expense_date) >= date(?)");
      params.push(String(req.query.from).slice(0, 10));
    }
    if (req.query.to) {
      where.push("date(e.expense_date) <= date(?)");
      params.push(String(req.query.to).slice(0, 10));
    }

    const rows = ids.length
      ? all(`${SELECT_EXPENSE} WHERE ${where.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC`, params)
      : [];

    const stats = ids.length
      ? get(
          `SELECT COUNT(*) AS records,
                  COALESCE(SUM(amount),0) AS total,
                  COALESCE(SUM(CASE WHEN date(expense_date) >= date('now','start of month') THEN amount ELSE 0 END),0) AS month
           FROM expenses e JOIN properties p ON p.id = e.property_id
           LEFT JOIN units u ON u.id = e.unit_id
           LEFT JOIN users uf ON uf.id = e.created_by
           WHERE ${where.join(' AND ')}`,
          params
        ) || { records: 0, total: 0, month: 0 }
      : { records: 0, total: 0, month: 0 };

    const byCategory = ids.length
      ? all(
          `SELECT e.category, COUNT(*) AS records, COALESCE(SUM(e.amount),0) AS total
           FROM expenses e JOIN properties p ON p.id = e.property_id
           LEFT JOIN units u ON u.id = e.unit_id
           LEFT JOIN users uf ON uf.id = e.created_by
           WHERE ${where.join(' AND ')} GROUP BY e.category ORDER BY total DESC`,
          params
        )
      : [];

    res.json({
      expenses: rows,
      stats: { records: Number(stats.records || 0), total: Number(stats.total || 0), month: Number(stats.month || 0) },
      byCategory,
      categories: CATEGORIES,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const expense = get(`${SELECT_EXPENSE} WHERE e.id = ?`, [Number(req.params.id)]);
    if (!expense) throw notFound('Expense not found');
    if (!canManage(req.user, expense.property_id)) throw forbidden();
    res.json({ expense });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const value = clean(req.body);
    validateExpense(value);
    if (!canManage(req.user, value.property_id)) throw forbidden();
    if (value.unit_id) {
      const unit = get('SELECT 1 AS x FROM units WHERE id = ? AND property_id = ?', [value.unit_id, value.property_id]);
      if (!unit) throw badRequest('Unit does not belong to this property', { unit_id: 'Invalid unit' });
    }
    const id = insert(
      `INSERT INTO expenses (property_id, unit_id, category, description, amount, expense_date, vendor, receipt_url, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.property_id, value.unit_id, value.category, value.description, value.amount, value.expense_date, value.vendor, value.receipt_url, value.notes, req.user.id]
    );
    audit(req, 'expense.created', 'expense', id, {
      amount: value.amount,
      category: value.category,
      expense_date: value.expense_date,
      property_id: value.property_id,
    }, { property_id: value.property_id });
    const landlordId = get('SELECT landlord_id FROM properties WHERE id = ?', [value.property_id]).landlord_id;
    if (req.user.id !== landlordId) {
      notify(landlordId, {
        type: 'expense',
        title: 'Expense recorded',
        body: `${value.category} expense of KES ${Number(value.amount).toLocaleString('en-KE')} was recorded by ${req.user.full_name}.`,
        link: '/app/expenses',
        dedupeKey: `expense-${id}`,
      });
    }
    const expense = get(`${SELECT_EXPENSE} WHERE e.id = ?`, [id]);
    res.status(201).json({ ok: true, expense });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = get(`${SELECT_EXPENSE} WHERE e.id = ?`, [Number(req.params.id)]);
    if (!existing) throw notFound('Expense not found');
    if (!canManage(req.user, existing.property_id)) throw forbidden();
    const value = clean(req.body, existing);
    validateExpense(value);
    if (!canManage(req.user, value.property_id)) throw forbidden();
    if (value.unit_id) {
      const unit = get('SELECT 1 AS x FROM units WHERE id = ? AND property_id = ?', [value.unit_id, value.property_id]);
      if (!unit) throw badRequest('Unit does not belong to this property', { unit_id: 'Invalid unit' });
    }
    run(
      `UPDATE expenses SET property_id = ?, unit_id = ?, category = ?, description = ?, amount = ?, expense_date = ?,
         vendor = ?, receipt_url = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [value.property_id, value.unit_id, value.category, value.description, value.amount, value.expense_date, value.vendor, value.receipt_url, value.notes, existing.id]
    );
    audit(req, 'expense.updated', 'expense', existing.id, { property_id: value.property_id }, { property_id: value.property_id });
    const expense = get(`${SELECT_EXPENSE} WHERE e.id = ?`, [existing.id]);
    res.json({ ok: true, expense });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = get(`${SELECT_EXPENSE} WHERE e.id = ?`, [Number(req.params.id)]);
    if (!existing) throw notFound('Expense not found');
    if (!canManage(req.user, existing.property_id)) throw forbidden();
    run('DELETE FROM expenses WHERE id = ?', [existing.id]);
    audit(req, 'expense.deleted', 'expense', existing.id, { property_id: existing.property_id }, { property_id: existing.property_id });
    res.json({ ok: true });
  })
);

export default router;