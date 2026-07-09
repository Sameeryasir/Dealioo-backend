export type OnboardingNextStep =
  | 'business_creation'
  | 'menu_setup'
  | null;

export type OnboardingStatusResponse = {
  businessId: number | null;
  twoFactorCompleted: boolean;
  businessCreated: boolean;
  menuCreated: boolean;
  onboardingCompleted: boolean;
  nextStep: OnboardingNextStep;
  redirectPath: string;
};
