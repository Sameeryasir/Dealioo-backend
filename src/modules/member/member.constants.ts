export const BUSINESS_MEMBER_ROLES = ['Manager', 'Staff'] as const;

export type BusinessMemberRole = (typeof BUSINESS_MEMBER_ROLES)[number];

export const CAMPAIGN_ACTION_PERMISSIONS = [
  'campaigns_view',
  'campaigns_create',
  'campaigns_edit',
  'campaigns_delete',
] as const;

export type CampaignActionPermission =
  (typeof CAMPAIGN_ACTION_PERMISSIONS)[number];

export const META_CAMPAIGN_ACTION_PERMISSIONS = [
  'meta_campaigns_view',
  'meta_campaigns_create',
  'meta_campaigns_delete',
] as const;

export type MetaCampaignActionPermission =
  (typeof META_CAMPAIGN_ACTION_PERMISSIONS)[number];

export type MetaCampaignAccessAction = 'view' | 'create' | 'delete';

export const GOOGLE_CAMPAIGN_ACTION_PERMISSIONS = [
  'google_campaigns_view',
  'google_campaigns_create',
  'google_campaigns_delete',
] as const;

export type GoogleCampaignActionPermission =
  (typeof GOOGLE_CAMPAIGN_ACTION_PERMISSIONS)[number];

export type GoogleCampaignAccessAction = 'view' | 'create' | 'delete';

export const BUSINESS_MEMBER_PERMISSIONS = [
  'campaigns',
  ...CAMPAIGN_ACTION_PERMISSIONS,
  'meta_ads',
  'meta_campaigns',
  ...META_CAMPAIGN_ACTION_PERMISSIONS,
  ...GOOGLE_CAMPAIGN_ACTION_PERMISSIONS,
  'orders',
  'activity',
  'chats',
  'scanning',
  'members',
  'settings',
] as const;

export type BusinessMemberPermission =
  (typeof BUSINESS_MEMBER_PERMISSIONS)[number];

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<
  BusinessMemberRole,
  BusinessMemberPermission[]
> = {
  Manager: [
    'campaigns_view',
    'campaigns_create',
    'campaigns_edit',
    'campaigns_delete',
    'meta_campaigns_view',
    'meta_campaigns_create',
    'meta_campaigns_delete',
    'google_campaigns_view',
    'google_campaigns_create',
    'google_campaigns_delete',
    'orders',
    'activity',
    'chats',
    'scanning',
  ],
  Staff: ['orders', 'activity', 'chats', 'scanning'],
};

export const ALL_BUSINESS_MEMBER_PERMISSIONS: BusinessMemberPermission[] = [
  ...BUSINESS_MEMBER_PERMISSIONS,
];

export function hasAnyCampaignPermission(
  permissions: readonly string[],
): boolean {
  if (permissions.includes('campaigns')) {
    return true;
  }
  return CAMPAIGN_ACTION_PERMISSIONS.some((key) => permissions.includes(key));
}

export function hasAnyMetaCampaignPermission(
  permissions: readonly string[],
): boolean {
  if (
    permissions.includes('meta_ads') ||
    permissions.includes('meta_campaigns')
  ) {
    return true;
  }
  return META_CAMPAIGN_ACTION_PERMISSIONS.some((key) =>
    permissions.includes(key),
  );
}

export function hasAnyGoogleCampaignPermission(
  permissions: readonly string[],
): boolean {
  if (permissions.includes('campaigns')) {
    return true;
  }
  return GOOGLE_CAMPAIGN_ACTION_PERMISSIONS.some((key) =>
    permissions.includes(key),
  );
}

export function campaignPermissionKeysFor(
  action: CampaignActionPermission,
): BusinessMemberPermission[] {
  return [action, 'campaigns'];
}

export function metaCampaignPermissionKeysFor(
  action: MetaCampaignAccessAction,
): BusinessMemberPermission[] {
  if (action === 'view') {
    return ['meta_campaigns_view', 'meta_ads', 'meta_campaigns'];
  }
  if (action === 'create') {
    return ['meta_campaigns_create', 'meta_campaigns'];
  }
  return ['meta_campaigns_delete', 'meta_campaigns'];
}

export function googleCampaignPermissionKeysFor(
  action: GoogleCampaignAccessAction,
): BusinessMemberPermission[] {
  if (action === 'view') {
    return ['google_campaigns_view', 'campaigns'];
  }
  if (action === 'create') {
    return ['google_campaigns_create', 'campaigns'];
  }
  return ['google_campaigns_delete', 'campaigns'];
}
