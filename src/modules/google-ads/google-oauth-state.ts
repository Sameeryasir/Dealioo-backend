import { createHmac, timingSafeEqual } from 'crypto';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createGoogleOAuthState(
  businessId: number,
  secret: string,
): string {
  const timestamp = Date.now();
  const payload = `${businessId}.${timestamp}`;
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function parseGoogleOAuthState(state: string, secret: string): number {
  const trimmed = state?.trim();
  if (!trimmed) {
    throw new Error('Missing Google OAuth state.');
  }

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Google OAuth state.');
  }

  const [businessIdRaw, timestampRaw, signature] = parts;
  const payload = `${businessIdRaw}.${timestampRaw}`;
  const expectedSignature = signPayload(payload, secret);

  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid Google OAuth state signature.');
  }

  const businessId = Number.parseInt(businessIdRaw, 10);
  const timestamp = Number.parseInt(timestampRaw, 10);

  if (!Number.isFinite(businessId) || businessId < 1) {
    throw new Error('Invalid business id in Google OAuth state.');
  }

  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid timestamp in Google OAuth state.');
  }

  if (Date.now() - timestamp > OAUTH_STATE_TTL_MS) {
    throw new Error('Google OAuth state expired. Try connecting again.');
  }

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
