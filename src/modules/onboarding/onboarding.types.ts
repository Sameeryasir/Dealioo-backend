export const ONBOARDING_VERSION = '2026-v1';

export type OnboardingNextStep = 'plan_selection' | 'business_creation' | null;

export type OnboardingChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  required: boolean;
};

export type OnboardingStatusResponse = {
  businessId: number | null;
  twoFactorCompleted: boolean;
  /** @deprecated Prefer subscriptionCompleted */
  subscriptionSelected: boolean;
  subscriptionCompleted: boolean;
  businessCreated: boolean;
  metaConnected: boolean;
  stripeConnected: boolean;
  teamInvited: boolean;
  firstCampaignCreated: boolean;
  customersImported: boolean;
  hasBusinessDraft: boolean;
  onboardingCompleted: boolean;
  onboardingVersion: string;
  nextStep: OnboardingNextStep;
  redirectPath: string;
  progress: number;
  checklist: OnboardingChecklistItem[];
};

export type BusinessOnboardingDraftPayload = {
  name?: string;
  phoneNumber?: string;
  email?: string;
  description?: string;
  websiteUrl?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  branchCount?: number;
};

export type BusinessOnboardingDraftResponse = {
  step: string;
  payload: BusinessOnboardingDraftPayload;
  logoUrl: string | null;
  updatedAt: string;
};
