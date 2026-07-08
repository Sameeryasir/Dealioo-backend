
export type GoogleAuthMode = 'login' | 'signup';

export interface GoogleAuthProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

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
  };
  isNewUser: boolean;
}
