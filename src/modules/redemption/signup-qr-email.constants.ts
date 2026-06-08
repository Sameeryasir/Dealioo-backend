export const SIGNUP_QR_EMAIL_QUEUE = 'signup-qr-email';

export enum SignupQrEmailJobName {
  SEND_IF_UNPAID = 'send-if-unpaid',
}

export function signupQrEmailJobId(
  customerId: number,
  funnelId: number,
): string {
  return `signup-qr-${customerId}-${funnelId}`;
}

export function isBuiltinSignupPassEmailEnabled(): boolean {
  const raw = process.env.BUILTIN_SIGNUP_PASS_EMAIL_ENABLED?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return false;
  }
  return true;
}

export function resolveSignupQrEmailDelayMs(): number {
  const raw = process.env.SIGNUP_QR_EMAIL_DELAY_MS?.trim();
  if (!raw) {
    return 5 * 60_000;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5 * 60_000;
}

export const SIGNUP_QR_EMAIL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: false,
};
