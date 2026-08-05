import { createHash } from 'crypto';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashEmailForMeta(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  return sha256Hex(normalizeEmail(email));
}

export function hashPhoneForMeta(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return sha256Hex(digits);
}

export function hashExternalIdForMeta(
  externalId: string | null | undefined,
): string | null {
  if (!externalId?.trim()) return null;
  return sha256Hex(externalId.trim());
}
