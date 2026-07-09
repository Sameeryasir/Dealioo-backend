export type OnboardingNextStep = 'business_creation' | null;

export type OnboardingStatusResponse = {
  businessId: number | null;
  twoFactorCompleted: boolean;
  businessCreated: boolean;
  onboardingCompleted: boolean;
  nextStep: OnboardingNextStep;
  redirectPath: string;
};
