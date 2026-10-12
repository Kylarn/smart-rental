import { config } from '../../../config.js';

function extractMessageId(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.message_id) return String(data.message_id);
  if (data.messageId) return String(data.messageId);
  if (data.id) return String(data.id);
  const atRecipient = data.SMSMessageData?.Recipients?.[0]?.messageId;
  if (atRecipient) return String(atRecipient);
  return null;
}

export function createHttpProvider() {
  return {
    name: 'http',
    label: 'Generic HTTP gateway',
    isReady: () => Boolean(config.sms.apiUrl && config.sms.apiKey),
    async send({ to, message }) {
      if (!config.sms.apiUrl || !config.sms.apiKey) {
        throw new Error('SMS HTTP provider is not configured (SMS_API_URL/SMS_API_KEY)');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let res;
      try {
        res = await fetch(config.sms.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.sms.apiKey}`,
          },
          body: JSON.stringify({ sender: config.sms.senderId, to, message }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const text = await res.text().catch(() => '');
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON response */
      }
      if (!res.ok) {
        throw new Error(`SMS gateway responded ${res.status}: ${text.slice(0, 200)}`);
      }
      return { id: extractMessageId(data) || `HTTP-${Date.now()}`, simulated: false };
    },
  };
}
