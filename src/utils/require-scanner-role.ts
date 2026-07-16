import { ForbiddenException } from '@nestjs/common';
import {
  isAdminOrSuperAdmin,
  MANAGER_ROLE,
  SCANNER_ROLE,
  STAFF_ROLE,
  SUPER_ADMIN_ROLE,
} from './user-roles';

const SCANNER_ROLES = new Set([
  'Admin',
  SUPER_ADMIN_ROLE,
  SCANNER_ROLE,
  MANAGER_ROLE,
  STAFF_ROLE,
]);

type UserLike = {
  role?: { name: string } | null;
} | null;

/** Staff who may preview and redeem QR passes at the business. */
export function requireScannerRole(
  user: UserLike,
  forbiddenMessage = 'You do not have permission to scan or redeem QR codes.',
): void {
  if (isAdminOrSuperAdmin(user)) {
    return;
  }

  const roleName = user?.role?.name?.trim();
  if (!roleName || !SCANNER_ROLES.has(roleName)) {
    throw new ForbiddenException(forbiddenMessage);
  }
}
