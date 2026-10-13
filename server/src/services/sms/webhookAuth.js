import crypto from 'node:crypto';

// Contract for the generic HTTP SMS gateway's delivery-status webhook.
//
// The generic gateway has no vendor-defined signature, so we require a standard
// HMAC-SHA256 shared-secret signature (the same pattern used by Stripe/GitHub):
//   - Header X-SMS-Signature: sha256=<hex digest>  (bare <hex> also accepted)
//   - HMAC key: SMS_WEBHOOK_SECRET
//   - Message: the raw request body, or `${X-SMS-Timestamp}.<body>` when a
//     timestamp header is supplied (enables replay protection).
//   - If X-SMS-Timestamp is present it must be within SMS_WEBHOOK_TOLERANCE_SECONDS.
//
// Gateways that cannot produce this signature cannot safely use the webhook; it
// fails closed. See docs/DEPLOYMENT.md.

export const SMS_SIGNATURE_HEADER = 'x-sms-signature';
export const SMS_TIMESTAMP_HEADER = 'x-sms-timestamp';

function parseSignature(header) {
  if (!header) return null;
  const value = String(header).trim();
  const match = /^(?:sha256=)?([0-9a-fA-F]{64})$/.exec(value);
  return match ? match[1].toLowerCase() : null;
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifySmsWebhookSignature({ secret, rawBody, headers, toleranceSeconds = 300 }) {
  if (!secret) return { ok: false, reason: 'webhook secret not configured' };

  const provided = parseSignature(headers?.[SMS_SIGNATURE_HEADER]);
  if (!provided) return { ok: false, reason: 'missing or malformed signature' };

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf8');
  const timestamp = headers?.[SMS_TIMESTAMP_HEADER];

  let signedPayload = raw;
  if (timestamp !== undefined && timestamp !== null && String(timestamp) !== '') {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid timestamp' };
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - ts) > toleranceSeconds) return { ok: false, reason: 'timestamp outside tolerance' };
    signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), raw]);
  }

  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (!timingSafeEqualHex(provided, expected)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}
