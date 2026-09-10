export const BUSINESS_MEMBER_STATUSES = ['active', 'inactive'] as const;

export type BusinessMemberStatus = (typeof BUSINESS_MEMBER_STATUSES)[number];

export const BUSINESS_MEMBER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const satisfies Record<string, BusinessMemberStatus>;
