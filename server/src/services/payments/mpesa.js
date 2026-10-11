import { run, get } from '../../db/index.js';
import { completePayment, failPayment, registerProvider } from './index.js';

const DARAJA_BASE = process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

const config = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  callbackUrl: process.env.MPESA_CALLBACK_URL,
};

function isReady() {
  return Boolean(config.consumerKey && config.consumerSecret && config.shortcode && config.passkey);
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
  const customerMessage = `Simulated STK push sent to ${phone}. Enter any M-Pesa PIN to approve (demo mode).`;
  setTimeout(() => {
    try {
      const pending = get('SELECT id FROM payments WHERE provider_ref = ? AND status IN (?, ?)', [
        checkoutRequestId,
        'pending',
        'processing',
      ]);
      if (!pending) return;
      const failChance = String(amount).endsWith('13');
      if (failChance) failPayment(pending.id, 'The M-Pesa request was cancelled by the user');
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
  handleCallback(body) {
    const cb = body?.Body?.stkCallback;
    if (!cb) return null;
    const payment = get('SELECT * FROM payments WHERE provider_ref = ?', [cb.CheckoutRequestID]);
    if (!payment) return null;
    if (payment.status === 'completed') return cb;
    if (['failed', 'cancelled'].includes(payment.status)) return null;

    if (cb.ResultCode === 0) {
      const items = cb.CallbackMetadata?.Items || [];
      const amountItem = items.find((i) => i.Name === 'Amount');
      const cbAmount = amountItem ? Number(amountItem.Value) : null;
      if (cbAmount !== null && !Number.isNaN(cbAmount) && Math.abs(cbAmount - Number(payment.amount)) > 1) {
        failPayment(payment.id, 'Callback amount does not match the requested payment amount');
        return cb;
      }
      const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;
      run('UPDATE payments SET reference = ? WHERE id = ?', [receipt ? String(receipt) : null, payment.id]);
      completePayment(payment.id);
    } else {
      failPayment(payment.id, cb.ResultDesc || 'M-Pesa payment was not completed');
    }
    return cb;
  },
};

registerProvider('mpesa', mpesaProvider);

export default mpesaProvider;
