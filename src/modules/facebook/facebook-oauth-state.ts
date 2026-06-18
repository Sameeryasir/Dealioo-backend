import { createHmac, timingSafeEqual } from 'crypto';

/** OAuth state expires after 10 minutes — limits replay window. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Builds a signed OAuth state that embeds the restaurant ID.
 * One Meta App serves all restaurants; state ties each callback to one tenant.
 */
export function createFacebookOAuthState(
  restaurantId: number,
  secret: string,
): string {
  const timestamp = Date.now();
  const payload = `${restaurantId}.${timestamp}`;
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

/**
 * Validates signature + TTL, then returns the restaurant ID from state.
 */
export function parseFacebookOAuthState(
  state: string,
  secret: string,
): number {
  const trimmed = state?.trim();
  if (!trimmed) {
    throw new Error('Missing Facebook OAuth state.');
  }

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Facebook OAuth state.');
  }

  const [restaurantIdRaw, timestampRaw, signature] = parts;
  const payload = `${restaurantIdRaw}.${timestampRaw}`;
  const expectedSignature = signPayload(payload, secret);

  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid Facebook OAuth state signature.');
  }

  const restaurantId = Number.parseInt(restaurantIdRaw, 10);
  const timestamp = Number.parseInt(timestampRaw, 10);

  if (!Number.isFinite(restaurantId) || restaurantId < 1) {
    throw new Error('Invalid restaurant id in Facebook OAuth state.');
  }

  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid timestamp in Facebook OAuth state.');
  }

  if (Date.now() - timestamp > OAUTH_STATE_TTL_MS) {
    throw new Error('Facebook OAuth state expired. Try connecting again.');
  }

  return restaurantId;
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
