export type OnboardingNextStep =
  | 'restaurant_creation'
  | 'two_factor'
  | 'menu_setup'
  | null;

export type OnboardingStatusResponse = {
  restaurantId: number | null;
  twoFactorCompleted: boolean;
  restaurantCreated: boolean;
  menuCreated: boolean;
  onboardingCompleted: boolean;
  nextStep: OnboardingNextStep;
  redirectPath: string;
};
