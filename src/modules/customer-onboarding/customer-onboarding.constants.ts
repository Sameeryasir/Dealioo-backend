export const MEETING_ATTENDANCE = {
  ATTENDED: 'ATTENDED',
  NO_SHOW: 'NO_SHOW',
  CANCELLED: 'CANCELLED',
} as const;

export type MeetingAttendance =
  (typeof MEETING_ATTENDANCE)[keyof typeof MEETING_ATTENDANCE];

export const MEETING_SALES_OUTCOME = {
  PENDING_DECISION: 'PENDING_DECISION',
  DEAL_WON: 'DEAL_WON',
  FOLLOW_UP_REQUIRED: 'FOLLOW_UP_REQUIRED',
  DEAL_LOST: 'DEAL_LOST',
} as const;

export type MeetingSalesOutcome =
  (typeof MEETING_SALES_OUTCOME)[keyof typeof MEETING_SALES_OUTCOME];

export const CUSTOMER_ONBOARDING_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  APPROVED: 'APPROVED',
  INVITATION_SENT: 'INVITATION_SENT',
  ACTIVATED: 'ACTIVATED',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED',
} as const;

export type CustomerOnboardingStatus =
  (typeof CUSTOMER_ONBOARDING_STATUS)[keyof typeof CUSTOMER_ONBOARDING_STATUS];

export const ONBOARDING_TASK_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;

export type OnboardingTaskStatus =
  (typeof ONBOARDING_TASK_STATUS)[keyof typeof ONBOARDING_TASK_STATUS];

export const ONBOARDING_TASK_KEYS = [
  'customer_information',
  'business_information',
  'subscription_billing',
  'business_configuration',
  'marketing_configuration',
  'review_approval',
  'customer_invitation',
] as const;

export type OnboardingTaskKey = (typeof ONBOARDING_TASK_KEYS)[number];

export const ONBOARDING_TASK_LABELS: Record<OnboardingTaskKey, string> = {
  customer_information: 'Customer Information',
  business_information: 'Business Information',
  subscription_billing: 'Subscription & Billing',
  business_configuration: 'Business Configuration',
  marketing_configuration: 'Marketing Configuration',
  review_approval: 'Review & Approval',
  customer_invitation: 'Customer Invitation',
};

export const ACTIVE_ONBOARDING_STATUSES: CustomerOnboardingStatus[] = [
  CUSTOMER_ONBOARDING_STATUS.NOT_STARTED,
  CUSTOMER_ONBOARDING_STATUS.IN_PROGRESS,
  CUSTOMER_ONBOARDING_STATUS.READY_FOR_REVIEW,
  CUSTOMER_ONBOARDING_STATUS.APPROVED,
  CUSTOMER_ONBOARDING_STATUS.INVITATION_SENT,
  CUSTOMER_ONBOARDING_STATUS.ACTIVATED,
  CUSTOMER_ONBOARDING_STATUS.ON_HOLD,
];
