
export type GoogleAuthMode = 'login' | 'signup';

export interface GoogleAuthProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

export type AuthUserPlanSummary = {
  id: string;
  planId: string;
  planSlug: string;
  planName: string;
  billingCycle: 'monthly' | 'annual';
  status: string;
  startedAt: string | null;
} | null;

export interface GoogleAuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    email: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    avatar: string | null;
    phone: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    isActive: boolean;
    provider: string;
    createdAt: Date;
    updatedAt: Date;
    role: { id: number; name: string };
    plan: AuthUserPlanSummary;
  };
  isNewUser: boolean;
}
