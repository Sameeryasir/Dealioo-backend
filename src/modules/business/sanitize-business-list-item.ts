import { Business } from '../../db/entities/business.entity';
import { computeBusinessSetupProgressFromEntity } from './business-setup-progress';

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
  googleAdsConnected: boolean;
  twilioConnected: boolean;
  twilioPhoneNumber: string | null;
  setupProgressPercent: number;
  isOwner: boolean;
};

export function sanitizeBusinessListItem(
  business: Business,
  options?: { viewerUserId?: number | null; isSuperAdmin?: boolean },
): PublicBusinessListItem {
  const stripeConnected = Boolean(business.stripeAccountId?.trim());
  const metaStatus = (business.metaConnectionStatus ?? '').trim().toUpperCase();
  const metaReadyStatus =
    metaStatus === 'AD_ACCOUNT_SELECTED' ||
    metaStatus === 'ACTIVE' ||
    metaStatus === 'SYNCING';
  const metaConnected = Boolean(
    business.metaUserId?.trim() &&
      business.metaAccessToken?.trim() &&
      business.metaAdAccountId?.trim() &&
      metaReadyStatus,
  );

  const googleStatus = (business.googleConnectionStatus ?? '')
    .trim()
    .toUpperCase();
  const googleReadyStatus =
    googleStatus === 'CUSTOMER_SELECTED' ||
    googleStatus === 'ACTIVE' ||
    googleStatus === 'SYNCING' ||
    googleStatus === 'TOKEN_EXCHANGED';
  const googleAdsConnected = Boolean(
    business.googleUserId?.trim() &&
      business.googleRefreshToken?.trim() &&
      googleReadyStatus &&
      googleStatus !== 'INITIATED' &&
      googleStatus !== 'FAILED',
  );

  const twilioPhoneNumber = business.twilioPhoneNumber?.trim() || null;
  const twilioConnected = Boolean(
    business.twilioPhoneSid?.trim() && twilioPhoneNumber,
  );

  const rawName = business.name?.trim() || '';
  const name = rawName || 'Untitled business';

  const ownerId = business.owner?.id ?? null;
  const viewerUserId = options?.viewerUserId ?? null;
  const isOwner = Boolean(
    options?.isSuperAdmin ||
      (viewerUserId != null && ownerId != null && ownerId === viewerUserId),
  );

  const flags = {
    stripeConnected,
    metaConnected,
    googleAdsConnected,
    twilioConnected,
  };

  return {
    id: business.id,
    name,
    slug: business.slug?.trim() || `business-${business.id}`,
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
    branchCount: business.branchCount ?? 0,
    onboardingCompleted: business.onboardingCompleted,
    onboardingCompletedAt: business.onboardingCompletedAt,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
    ...flags,
    twilioPhoneNumber,
    setupProgressPercent: computeBusinessSetupProgressFromEntity(
      { ...business, name: rawName },
      flags,
    ),
    isOwner,
  };
}
