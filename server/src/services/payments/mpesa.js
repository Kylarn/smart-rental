import { run, get } from '../../db/index.js';
import { completePayment, failPayment, registerProvider } from './index.js';

const DARAJA_BASE = process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

const config = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  callbackUrl: process.env.MPESA_CALLBACK_URL,
  amountTolerance: Number(process.env.MPESA_CALLBACK_AMOUNT_TOLERANCE || 1),
};

function isReady() {
  return Boolean(config.consumerKey && config.consumerSecret && config.shortcode && config.passkey);
}

// Never log tokens, passwords, phone numbers or raw provider payloads.
function logCallback(message, meta = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    safe[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  }
  console.warn(`[mpesa:callback] ${message}`, safe);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function getAccessToken() {
  const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error('Unable to authenticate with M-Pesa (check Daraja credentials)');
  const data = await res.json();
  return data.access_token;
}

async function realStkPush({ phone, amount, reference, accountRef }) {
  const token = await getAccessToken();
  const ts = timestamp();
  const password = Buffer.from(`${config.shortcode}${config.passkey}${ts}`).toString('base64');
  const localPhone = phone.replace(/^0/, '254').replace(/^\+/, '');
  const res = await fetch(`${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.max(1, Math.round(amount)),
      PartyA: localPhone,
      PartyB: config.shortcode,
      PhoneNumber: localPhone,
      CallBackURL: config.callbackUrl,
      AccountReference: (accountRef || 'SmartRentals').slice(0, 12),
      TransactionDesc: (reference || 'Rent payment').slice(0, 20),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'M-Pesa STK push could not be initiated');
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    customerMessage: data.CustomerMessage || 'Enter your M-Pesa PIN on your phone to complete the payment.',
    raw: data,
  };
}

function mockStkPush({ phone, amount }) {
  const checkoutRequestId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const customerMessage = `Simulated STK push sent to ${phone}. Enter any M-Pesa PIN to approve (mock mode).`;
  setTimeout(() => {
    try {
      const pending = get('SELECT id FROM payments WHERE provider_ref = ? AND status IN (?, ?)', [
        checkoutRequestId,
        'pending',
        'processing',
      ]);
      if (!pending) return;
      const failChance = String(amount).endsWith('13');
      if (failChance) failPayment(pending.id, 'Simulated M-Pesa failure (mock provider)');
      else completePayment(pending.id);
    } catch (err) {
      console.error('[mpesa:mock] completion error', err);
    }
  }, 4500);
  return {
    checkoutRequestId,
    merchantRequestId: checkoutRequestId,
    customerMessage,
    raw: { mock: true },
  };
}

// Daraja does not cryptographically sign STK Push callbacks, so a callback body
// can never be trusted on its own. The authoritative confirmation is a
// server-to-server STK Push Query signed with our own OAuth token + passkey.
async function stkQuery(checkoutRequestId) {
  const token = await getAccessToken();
  const ts = timestamp();
  const password = Buffer.from(`${config.shortcode}${config.passkey}${ts}`).toString('base64');
  const res = await fetch(`${DARAJA_BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { verified: false, definitiveFailure: false, code: null, reason: `Provider status query HTTP ${res.status}` };
  }
  const rawCode = data.ResultCode;
  if (rawCode === undefined || rawCode === null) {
    return {
      verified: false,
      definitiveFailure: false,
      code: null,
      reason: data.errorMessage || 'Provider status query returned no result code',
    };
  }
  const code = String(rawCode);
  if (code === '0') {
    return { verified: true, definitiveFailure: false, code, reason: data.ResultDesc || 'Provider confirmed success' };
  }
  return { verified: false, definitiveFailure: true, code, reason: data.ResultDesc || 'Provider reported failure' };
}

async function defaultVerify(checkoutRequestId) {
  if (!isReady()) {
    return {
      verified: false,
      definitiveFailure: false,
      code: null,
      reason: 'No M-Pesa credentials configured; callback cannot be verified',
    };
  }
  return stkQuery(checkoutRequestId);
}

let callbackVerifier = defaultVerify;

// Test seam: replace the provider verification with a deterministic double.
// Never use this outside tests.
export function setCallbackVerifier(fn) {
  callbackVerifier = typeof fn === 'function' ? fn : defaultVerify;
}

export function resetCallbackVerifier() {
  callbackVerifier = defaultVerify;
}

const mpesaProvider = {
  label: 'M-Pesa STK Push',
  isReady,
  async stkPush(args) {
    if (!isReady()) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('M-Pesa is not configured. Set MPESA_* production credentials before enabling live payments.');
      }
      return mockStkPush(args);
    }
    if (process.env.NODE_ENV === 'production') {
      if (process.env.MPESA_ENV !== 'production') {
        throw new Error('M-Pesa live payments require MPESA_ENV=production.');
      }
      if (!config.callbackUrl || !config.callbackUrl.startsWith('https://')) {
        throw new Error('M-Pesa live payments require a public HTTPS MPESA_CALLBACK_URL.');
      }
    }
    return realStkPush(args);
  },
  async handleCallback(body) {
    const cb = body?.Body?.stkCallback;
    if (!cb || !cb.CheckoutRequestID) return { accepted: false, status: 'malformed' };
    const checkoutRequestId = String(cb.CheckoutRequestID);

    // 1. Correlate with a server-created transaction. References we never issued
    //    are ignored and never mutate state.
    const payment = get('SELECT * FROM payments WHERE provider_ref = ?', [checkoutRequestId]);
    if (!payment) return { accepted: false, status: 'unknown' };
    if (payment.status === 'completed') return { accepted: true, status: 'duplicate' };
    if (['failed', 'cancelled'].includes(payment.status)) return { accepted: false, status: 'final' };

    // 2. Merchant + checkout references must match what we recorded at initiation.
    if (payment.merchant_request_id && cb.MerchantRequestID && String(cb.MerchantRequestID) !== String(payment.merchant_request_id)) {
      logCallback('merchant reference mismatch', { payment_id: payment.id });
      return { accepted: false, status: 'mismatch' };
    }

    // 3. Authenticate the callback with the provider (server-to-server). The body
    //    is never trusted on its own; fail closed if verification is unavailable.
    let verdict;
    try {
      verdict = await callbackVerifier(checkoutRequestId);
    } catch (err) {
      logCallback('verification error', { payment_id: payment.id, message: String(err.message || err) });
      return { accepted: false, status: 'unverified' };
    }
    if (!verdict || !verdict.verified) {
      if (verdict?.definitiveFailure && Number(cb.ResultCode) !== 0) {
        failPayment(payment.id, cb.ResultDesc || 'M-Pesa payment was not completed');
        return { accepted: true, status: 'failed' };
      }
      logCallback('callback not verified', { payment_id: payment.id, reason: verdict?.reason });
      return { accepted: false, status: 'unverified' };
    }

    // 4. Provider confirmed success - now enforce our own invariants before we
    //    complete the payment.
    if (Number(cb.ResultCode) !== 0) {
      logCallback('provider success but callback reported failure', { payment_id: payment.id });
      return { accepted: false, status: 'mismatch' };
    }
    const items = cb.CallbackMetadata?.Items || [];
    const amountItem = items.find((i) => i.Name === 'Amount');
    const cbAmount = amountItem ? Number(amountItem.Value) : null;
    if (cbAmount !== null && !Number.isNaN(cbAmount) && Math.abs(cbAmount - Number(payment.amount)) > config.amountTolerance) {
      failPayment(payment.id, 'Callback amount does not match the requested payment amount');
      return { accepted: true, status: 'amount_mismatch' };
    }

    const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;
    if (receipt) run('UPDATE payments SET reference = ? WHERE id = ?', [String(receipt), payment.id]);
    completePayment(payment.id);
    return { accepted: true, status: 'completed' };
  },
};

registerProvider('mpesa', mpesaProvider);

export default mpesaProvider;
