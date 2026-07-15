import { Business } from '../../db/entities/business.entity';

export type PublicBusinessListItem = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  email: string | null;
  phoneNumber: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  branchCount: number;
  onboardingCompleted: boolean;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  stripeConnected: boolean;
  metaConnected: boolean;
};

export function sanitizeBusinessListItem(
  business: Business,
): PublicBusinessListItem {
  const stripeConnected = Boolean(business.stripeAccountId?.trim());
  const metaConnected = Boolean(
    business.metaUserId?.trim() ||
      business.metaAccessToken?.trim() ||
      business.metaConnectionStatus?.trim() === 'ACTIVE',
  );

  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    description: business.description,
    logoUrl: business.logoUrl,
    websiteUrl: business.websiteUrl,
    email: business.email,
    phoneNumber: business.phoneNumber,
    city: business.city,
    state: business.state,
    country: business.country,
    postalCode: business.postalCode,
    branchCount: business.branchCount,
    onboardingCompleted: business.onboardingCompleted,
    onboardingCompletedAt: business.onboardingCompletedAt,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
    stripeConnected,
    metaConnected,
  };
}
