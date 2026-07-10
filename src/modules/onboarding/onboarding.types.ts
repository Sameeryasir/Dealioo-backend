export type OnboardingNextStep = 'plan_selection' | 'business_creation' | null;

export type OnboardingStatusResponse = {
  businessId: number | null;
  twoFactorCompleted: boolean;
  subscriptionSelected: boolean;
  businessCreated: boolean;
  onboardingCompleted: boolean;
  nextStep: OnboardingNextStep;
  redirectPath: string;
};
