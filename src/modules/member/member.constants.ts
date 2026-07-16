export const BUSINESS_MEMBER_ROLES = ['Manager', 'Staff'] as const;

export type BusinessMemberRole = (typeof BUSINESS_MEMBER_ROLES)[number];

export const MEMBER_INVITE_EXPIRY_DAYS = 7;

export const BUSINESS_MEMBER_PERMISSIONS = [
  'campaigns',
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
  Manager: ['campaigns', 'orders', 'activity', 'chats', 'scanning'],
  Staff: ['orders', 'activity', 'chats', 'scanning'],
};

export const ALL_BUSINESS_MEMBER_PERMISSIONS: BusinessMemberPermission[] = [
  ...BUSINESS_MEMBER_PERMISSIONS,
];
