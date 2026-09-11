import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import {
  BUSINESS_MEMBER_PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  type BusinessMemberPermission as BusinessMemberPermissionKey,
  type BusinessMemberRole,
} from './member.constants';

export function normalizeMemberPermissions(
  permissions: string[] | undefined,
  role: BusinessMemberRole,
): BusinessMemberPermissionKey[] {
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
  ] as BusinessMemberPermissionKey[];

  if (normalized.length === 0) {
    throw new BadRequestException('Select at least one access permission.');
  }

  return normalized;
}

export function sanitizeStoredMemberPermissions(
  permissions: string[] | undefined | null,
  role: BusinessMemberRole,
): BusinessMemberPermissionKey[] {
  const allowed = new Set<string>(BUSINESS_MEMBER_PERMISSIONS);
  const filtered = [
    ...new Set(
      (permissions ?? [])
        .map((permission) => permission.trim())
        .filter((permission) => allowed.has(permission)),
    ),
  ] as BusinessMemberPermissionKey[];

  if (filtered.length > 0) {
    return filtered;
  }

  return [...DEFAULT_PERMISSIONS_BY_ROLE[role]];
}

export async function syncMemberPermissionRows(
  manager: EntityManager,
  memberId: number,
  permissions: BusinessMemberPermissionKey[],
): Promise<void> {
  const permissionRepo = manager.getRepository(BusinessMemberPermission);
  await permissionRepo.delete({ businessMember: { id: memberId } });
  if (permissions.length === 0) {
    return;
  }
  await permissionRepo.save(
    permissions.map((permission) =>
      permissionRepo.create({
        businessMember: { id: memberId } as BusinessMember,
        permission,
      }),
    ),
  );
}
