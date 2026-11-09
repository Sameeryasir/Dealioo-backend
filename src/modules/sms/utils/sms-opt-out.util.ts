export type SmsOptOutIntent = 'opt_out' | 'opt_in' | null;

const OPT_OUT_EXACT = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'revoke',
  'optout',
  'opt out',
  'opt-out',
]);

const OPT_IN_EXACT = new Set([
  'start',
  'unstop',
  'subscribe',
  'yes',
  'optin',
  'opt in',
  'opt-in',
]);

const OPT_OUT_PHRASES = [
  'do not text',
  "don't text",
  'dont text',
  'do not message',
  "don't message",
  'dont message',
  'do not sms',
  "don't sms",
  'do not receive',
  "don't receive",
  'dont receive',
  "don't want to receive",
  'dont want to receive',
  'do not want to receive',
  'stop messaging',
  'stop texting',
  'no more texts',
  'no more messages',
  'remove me',
  'leave me alone',
];

function normalizeSmsBody(body: string): string {
  return body
    .trim()
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectSmsOptOutIntent(body: string): SmsOptOutIntent {
  const normalized = normalizeSmsBody(body);
  if (!normalized) return null;

  if (OPT_OUT_EXACT.has(normalized)) return 'opt_out';
  if (OPT_IN_EXACT.has(normalized)) return 'opt_in';

  if (normalized.length <= 80) {
    for (const phrase of OPT_OUT_PHRASES) {
      if (normalized.includes(phrase)) return 'opt_out';
    }
  }

  return null;
}

export const SMS_OPT_OUT_CONFIRMATION =
  "You're unsubscribed from SMS from this business. Reply START if you want messages again.";

export const SMS_OPT_IN_CONFIRMATION =
  "You're subscribed to SMS from this business again. Reply STOP to unsubscribe.";

export function buildSmsOptOutTwiml(message: string): string {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}
