import { BadRequestException } from '@nestjs/common';
import {
  BUSINESS_MEMBER_PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  type BusinessMemberPermission,
  type BusinessMemberRole,
} from './member.constants';

export function normalizeMemberPermissions(
  permissions: string[] | undefined,
  role: BusinessMemberRole,
): BusinessMemberPermission[] {
  const allowed = new Set<string>(BUSINESS_MEMBER_PERMISSIONS);

  const source =
    permissions && permissions.length > 0
      ? permissions
      : DEFAULT_PERMISSIONS_BY_ROLE[role];

  const normalized = [
    ...new Set(
      source
        .map((permission) => permission.trim())
        .filter((permission) => allowed.has(permission)),
    ),
  ] as BusinessMemberPermission[];

  if (normalized.length === 0) {
    throw new BadRequestException('Select at least one access permission.');
  }

  return normalized;
}
