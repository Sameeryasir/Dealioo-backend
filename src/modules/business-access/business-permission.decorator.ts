import { SetMetadata } from '@nestjs/common';
import type { BusinessMemberPermission } from '../member/member.constants';

export const BUSINESS_PERMISSION_KEY = 'business_permission';

export const BusinessPermission = (permission: BusinessMemberPermission) =>
  SetMetadata(BUSINESS_PERMISSION_KEY, permission);
