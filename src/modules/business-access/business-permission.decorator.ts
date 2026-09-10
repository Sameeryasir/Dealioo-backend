import { SetMetadata } from '@nestjs/common';
import type { BusinessMemberPermission } from '../member/member.constants';
import type { BusinessPermissionAlias } from './business-permission-aliases';

export const BUSINESS_PERMISSION_KEY = 'business_permission';

export type RequireBusinessPermissionInput =
  | BusinessMemberPermission
  | BusinessPermissionAlias
  | Array<BusinessMemberPermission | BusinessPermissionAlias>;

export const BusinessPermission = (
  permission: RequireBusinessPermissionInput,
) => SetMetadata(BUSINESS_PERMISSION_KEY, permission);

export const RequireBusinessPermission = BusinessPermission;
