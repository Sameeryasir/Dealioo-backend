export const BUSINESS_ONBOARDING_QUEUE = 'business-onboarding';

export type BusinessOnboardingJobName =
  | 'post_create_provisioning';

export type BusinessOnboardingPostCreateJob = {
  businessId: number;
  ownerUserId: number;
  businessName: string;
};
