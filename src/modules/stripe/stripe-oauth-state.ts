import { createHmac, timingSafeEqual } from 'crypto';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createStripeOAuthState(
  businessId: number,
  secret: string,
): string {
  const timestamp = Date.now();
  const payload = `${businessId}.${timestamp}`;
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function parseStripeOAuthState(state: string, secret: string): number {
  const trimmed = state?.trim();
  if (!trimmed) {
    throw new Error('Missing Stripe OAuth state.');
  }

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Stripe OAuth state.');
  }

  const [businessIdRaw, timestampRaw, signature] = parts;
  const payload = `${businessIdRaw}.${timestampRaw}`;
  const expectedSignature = signPayload(payload, secret);

  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid Stripe OAuth state signature.');
  }

  const businessId = Number.parseInt(businessIdRaw, 10);
  const timestamp = Number.parseInt(timestampRaw, 10);

  if (!Number.isFinite(businessId) || businessId < 1) {
    throw new Error('Invalid business id in Stripe OAuth state.');
  }

  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid timestamp in Stripe OAuth state.');
  }

  if (Date.now() - timestamp > OAUTH_STATE_TTL_MS) {
    throw new Error('Stripe OAuth state expired. Try connecting again.');
  }

  return businessId;
}

export function peekStripeOAuthStateBusinessId(
  state: string | undefined,
  secret: string,
): number | null {
  const trimmed = state?.trim();
  if (!trimmed || !secret.trim()) return null;

  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;

  const [businessIdRaw, timestampRaw, signature] = parts;
  const payload = `${businessIdRaw}.${timestampRaw}`;
  const expectedSignature = signPayload(payload, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  const businessId = Number.parseInt(businessIdRaw, 10);
  if (!Number.isFinite(businessId) || businessId < 1) return null;
  return businessId;
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
