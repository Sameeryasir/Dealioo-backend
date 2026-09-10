import { ForbiddenException } from '@nestjs/common';
import {
  ADMIN_ROLE,
  isAdminOrSuperAdmin,
  isMemberRole,
  MEMBER_ROLE,
  SUPER_ADMIN_ROLE,
} from './user-roles';

const PLATFORM_SCAN_ALLOWED = new Set([
  ADMIN_ROLE,
  SUPER_ADMIN_ROLE,
  MEMBER_ROLE,
]);

type UserLike = {
  role?: { name: string } | null;
} | null;

export function requireScannerRole(
  user: UserLike,
  forbiddenMessage = 'You do not have permission to scan or redeem QR codes.',
): void {
  if (isAdminOrSuperAdmin(user) || isMemberRole(user?.role?.name)) {
    return;
  }

  const roleName = user?.role?.name?.trim();
  if (!roleName || !PLATFORM_SCAN_ALLOWED.has(roleName)) {
    throw new ForbiddenException(forbiddenMessage);
  }
}
