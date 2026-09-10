import type { BusinessMemberPermission } from '../member/member.constants';

export const BUSINESS_PERMISSION_ALIASES = {
  'campaign.view': ['campaigns', 'campaigns_view', 'campaigns_create', 'campaigns_edit', 'campaigns_delete'],
  'campaign.create': ['campaigns_create', 'campaigns'],
  'campaign.update': ['campaigns_edit', 'campaigns'],
  'campaign.delete': ['campaigns_delete', 'campaigns'],
  'analytics.view': ['activity'],
  'customer.view': ['orders', 'activity'],
  'redemption.process': ['scanning'],
  'staff.invite': ['members'],
  'staff.remove': ['members'],
  'branch.manage': ['settings'],
  'twilio.manage': ['settings'],
  'google_ads.manage': ['google_campaigns_view', 'google_campaigns_create', 'google_campaigns_delete', 'campaigns'],
  'billing.manage': ['settings'],
} as const satisfies Record<string, readonly BusinessMemberPermission[]>;

export type BusinessPermissionAlias = keyof typeof BUSINESS_PERMISSION_ALIASES;

export function resolveBusinessPermissionKeys(
  permission: BusinessMemberPermission | BusinessPermissionAlias,
): BusinessMemberPermission[] {
  if (permission in BUSINESS_PERMISSION_ALIASES) {
    return [
      ...(BUSINESS_PERMISSION_ALIASES[
        permission as BusinessPermissionAlias
      ] as readonly BusinessMemberPermission[]),
    ];
  }
  return [permission as BusinessMemberPermission];
}
