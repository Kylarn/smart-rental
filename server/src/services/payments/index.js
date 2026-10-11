import { get, insert, all, run } from '../../db/index.js';
import { notify, auditLog } from '../notify.js';

const providers = new Map();

export function registerProvider(name, provider) {
  providers.set(name, provider);
}

export function getProvider(name) {
  const provider = providers.get(name) || providers.get('mpesa');
  if (!provider) throw new Error('No payment provider configured');
  return provider;
}

export function listProviders() {
  return [...providers.entries()].map(([name, p]) => ({ name, label: p.label, ready: p.isReady?.() ?? false }));
}

export function nextReceiptNumber() {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const row = get("SELECT COUNT(*) AS c FROM payments WHERE receipt_number LIKE ?", [`SR-${ymd}-%`]);
  return `SR-${ymd}-${String(row.c + 1).padStart(4, '0')}`;
}

export function completePayment(paymentId, extra = {}) {
  const payment = get('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment) return null;
  if (payment.status === 'completed') return payment;
  if (['failed', 'cancelled'].includes(payment.status)) return null;

  const receipt = payment.receipt_number || nextReceiptNumber();
  run(
    `UPDATE payments SET status = 'completed', receipt_number = ?, paid_at = COALESCE(paid_at, ?), failure_reason = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [receipt, new Date().toISOString(), paymentId]
  );

  const updated = get('SELECT * FROM payments WHERE id = ?', [paymentId]);
  const tenant = get('SELECT id, full_name FROM users WHERE id = ?', [payment.tenant_id]);
  const periodLabel = payment.period
    ? new Date(`${payment.period}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
    : '';

  notify(payment.tenant_id, {
    type: 'success',
    title: 'Payment received',
    body: `Your payment of KES ${Number(payment.amount).toLocaleString('en-KE')} for ${periodLabel} rent was received. Receipt ${receipt}.`,
    link: '/tenant/payments',
    dedupeKey: `payment-${paymentId}`,
  });

  if (payment.property_id) {
    all('SELECT landlord_id FROM properties WHERE id = ?', [payment.property_id]).forEach((p) =>
      notify(p.landlord_id, {
        type: 'success',
        title: 'Rent payment received',
        body: `${tenant?.full_name || 'A tenant'} paid KES ${Number(payment.amount).toLocaleString('en-KE')}${periodLabel ? ` for ${periodLabel}` : ''}. Receipt ${receipt}.`,
        link: '/landlord/payments',
        dedupeKey: `payment-landlord-${paymentId}`,
      })
    );
  }

  auditLog(null, 'payment.completed', 'payment', paymentId, { receipt, amount: payment.amount, method: payment.method }, null, payment.property_id, null);
  if (extra.onComplete) extra.onComplete(updated);
  return updated;
}

export function failPayment(paymentId, reason = 'Payment failed') {
  const payment = get('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment || payment.status === 'completed') return null;
  run(
    `UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [reason, paymentId]
  );
  notify(payment.tenant_id, {
    type: 'error',
    title: 'Payment failed',
    body: `${reason}. You can try again from the Rent & Payments page.`,
    link: '/tenant/payments',
    dedupeKey: `payment-fail-${paymentId}`,
  });
  return get('SELECT * FROM payments WHERE id = ?', [paymentId]);
}

export function recoverStuckPayments() {
  const stuck = all(
    `SELECT * FROM payments WHERE status IN ('pending','processing') AND created_at < datetime('now', '-10 minutes')`
  );
  stuck.forEach((p) => {
    if (p.provider === 'mpesa' && String(p.provider_ref || '').startsWith('MOCK')) {
      completePayment(p.id);
    } else {
      failPayment(p.id, 'Payment timed out before confirmation');
    }
  });
  return stuck.length;
}
