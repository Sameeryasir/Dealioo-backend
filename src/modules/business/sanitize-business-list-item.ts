import { Business } from '../../db/entities/business.entity';

export type PublicBusinessListItem = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  businessType: string | null;
  currency: string | null;
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
  twilioConnected: boolean;
  twilioPhoneNumber: string | null;
};

export function sanitizeBusinessListItem(
  business: Business,
): PublicBusinessListItem {
  // --- Integration flags (IDs alone are not “connected”) ---
  // Stripe: OAuth callback is the only writer of stripeAccountId. No charges_enabled
  // column exists yet, so a stored id means Connect finished — never infer this on FE.
  const stripeConnected = Boolean(business.stripeAccountId?.trim());
  const metaStatus = (business.metaConnectionStatus ?? '').trim().toUpperCase();
  const metaReadyStatus =
    metaStatus === 'AD_ACCOUNT_SELECTED' ||
    metaStatus === 'ACTIVE' ||
    metaStatus === 'SYNCING';
  // Meta Ads: user + token + selected ad account + a ready status. User id alone ≠ connected.
  const metaConnected = Boolean(
    business.metaUserId?.trim() &&
      business.metaAccessToken?.trim() &&
      business.metaAdAccountId?.trim() &&
      metaReadyStatus,
  );
  const twilioPhoneNumber = business.twilioPhoneNumber?.trim() || null;
  // Twilio: SID and a live number must both be present.
  const twilioConnected = Boolean(
    business.twilioPhoneSid?.trim() && twilioPhoneNumber,
  );

  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    description: business.description,
    logoUrl: business.logoUrl,
    businessType: business.businessType ?? null,
    currency: business.currency ?? null,
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
    twilioConnected,
    twilioPhoneNumber,
  };
}
