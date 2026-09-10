import type { PublicBusinessListItem } from './sanitize-business-list-item';
import type { Business } from '../../db/entities/business.entity';

type SetupScoreInput = Pick<
  PublicBusinessListItem,
  | 'name'
  | 'logoUrl'
  | 'email'
  | 'phoneNumber'
  | 'city'
  | 'state'
  | 'country'
  | 'postalCode'
  | 'branchCount'
  | 'twilioConnected'
  | 'stripeConnected'
  | 'metaConnected'
  | 'googleAdsConnected'
>;

function hasMeaningfulAddress(input: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
}): boolean {
  const city = input.city?.trim() ?? '';
  if (city.length < 2) return false;
  return [input.state, input.country, input.postalCode].some((part) =>
    Boolean(part?.trim()),
  );
}

export function computeBusinessSetupProgressPercent(
  item: SetupScoreInput,
): number {
  const checks = [
    Boolean(item.name?.trim()),
    Boolean(item.logoUrl?.trim()),
    Boolean(item.email?.trim()) && Boolean(item.phoneNumber?.trim()),
    hasMeaningfulAddress(item),
    (item.branchCount ?? 0) > 0,
    item.twilioConnected === true,
    item.stripeConnected === true,
    item.metaConnected === true,
    item.googleAdsConnected === true,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

export function computeBusinessSetupProgressFromEntity(
  business: Business,
  flags: Pick<
    PublicBusinessListItem,
    | 'stripeConnected'
    | 'metaConnected'
    | 'googleAdsConnected'
    | 'twilioConnected'
  >,
): number {
  return computeBusinessSetupProgressPercent({
    name: business.name?.trim() || '',
    logoUrl: business.logoUrl,
    email: business.email,
    phoneNumber: business.phoneNumber,
    city: business.city,
    state: business.state,
    country: business.country,
    postalCode: business.postalCode,
    branchCount: business.branchCount ?? 0,
    ...flags,
  });
}
