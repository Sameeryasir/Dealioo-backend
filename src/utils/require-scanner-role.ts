import { ForbiddenException } from '@nestjs/common';

const SCANNER_ROLES = new Set(['Admin', 'Scanner']);

type UserLike = {
  role?: { name: string } | null;
} | null;

/** Staff who may preview and redeem QR passes at the business. */
export function requireScannerRole(
  user: UserLike,
  forbiddenMessage = 'You do not have permission to scan or redeem QR codes.',
): void {
  const roleName = user?.role?.name?.trim();
  if (!roleName || !SCANNER_ROLES.has(roleName)) {
    throw new ForbiddenException(forbiddenMessage);
  }
}
