import { BadRequestException } from '@nestjs/common';
import { enums, toMicros } from 'google-ads-api';
import type {
  GoogleAdCreativeDraftData,
  GoogleCampaignBuilderDraftData,
  GoogleBidStrategyId,
  GoogleKeywordMatchType,
} from '../../db/entities/google-campaign-builder-draft.types';

export type GoogleCampaignBudgetPayload = {
  name: string;
  amountMicros: number;
  deliveryMethod: number;
  explicitlyShared: boolean;
};

export type GoogleCampaignCreatePayload = {
  name: string;
  status: number;
  advertisingChannelType: number;
  bidding: Record<string, unknown>;
  networkSettings: {
    targetGoogleSearch: boolean;
    targetSearchNetwork: boolean;
    targetContentNetwork: boolean;
  };
  containsEuPoliticalAdvertising: number;
  startDate?: string;
  endDate?: string;
};

export type GoogleAdGroupCreatePayload = {
  name: string;
  status: number;
  type: number;
};

export type GoogleKeywordCreatePayload = {
  text: string;
  matchType: number;
};

export type GoogleResponsiveSearchAdPayload = {
  finalUrls: string[];
  headlines: Array<{ text: string }>;
  descriptions: Array<{ text: string }>;
  path1?: string;
  path2?: string;
};

export type GoogleGeoTargetPayload = {
  rawId: string;
  name: string;
  type: 'country' | 'state' | 'city' | 'postal_code';
  negative: boolean;
};

export type GoogleProximityPayload = {
  latitude: number;
  longitude: number;
  radiusValue: number;
  radiusUnit: 'KILOMETERS' | 'MILES';
  centerLocationId?: string;
  addressLabel?: string;
  negative?: boolean;
};

const LANGUAGE_CRITERION_IDS: Record<string, string> = {
  arabic: '1019',
  bengali: '1056',
  bulgarian: '1020',
  catalan: '1038',
  chinese: '1017',
  'chinese (simplified)': '1017',
  'chinese (traditional)': '1018',
  croatian: '1039',
  czech: '1021',
  danish: '1009',
  dutch: '1010',
  english: '1000',
  estonian: '1043',
  filipino: '1042',
  finnish: '1011',
  french: '1002',
  german: '1001',
  greek: '1022',
  gujarati: '1072',
  hebrew: '1027',
  hindi: '1023',
  hungarian: '1024',
  icelandic: '1026',
  indonesian: '1025',
  italian: '1004',
  japanese: '1005',
  kannada: '1086',
  korean: '1012',
  latvian: '1028',
  lithuanian: '1029',
  malay: '1102',
  malayalam: '1098',
  marathi: '1101',
  norwegian: '1013',
  persian: '1064',
  polish: '1030',
  portuguese: '1014',
  punjabi: '1110',
  romanian: '1032',
  russian: '1031',
  serbian: '1035',
  slovak: '1033',
  slovenian: '1034',
  spanish: '1003',
  swedish: '1015',
  tamil: '1130',
  telugu: '1131',
  thai: '1044',
  turkish: '1037',
  ukrainian: '1036',
  urdu: '1041',
  vietnamese: '1040',
};

function yyyymmdd(isoDate: string | undefined | null): string | undefined {
  const trimmed = isoDate?.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return `${match[1]}${match[2]}${match[3]}`;
}

function mapMatchType(matchType: GoogleKeywordMatchType | undefined): number {
  switch (matchType) {
    case 'EXACT':
      return enums.KeywordMatchType.EXACT;
    case 'PHRASE':
      return enums.KeywordMatchType.PHRASE;
    case 'BROAD':
    default:
      return enums.KeywordMatchType.BROAD;
  }
}

function mapBidding(draft: GoogleCampaignBuilderDraftData): Record<string, unknown> {
  const strategy: GoogleBidStrategyId = draft.bidStrategy || 'MAXIMIZE_CLICKS';
  switch (strategy) {
    case 'MAXIMIZE_CONVERSIONS':
      return { maximize_conversions: {} };
    case 'MAXIMIZE_CONVERSION_VALUE':
      return { maximize_conversion_value: {} };
    case 'MANUAL_CPC':
      return { manual_cpc: { enhanced_cpc_enabled: true } };
    case 'TARGET_CPA': {
      const cpa = Number(draft.targetCpa);
      if (!Number.isFinite(cpa) || cpa <= 0) {
        throw new BadRequestException(
          'Enter a valid target CPA for this bid strategy.',
        );
      }
      return { target_cpa: { target_cpa_micros: toMicros(cpa) } };
    }
    case 'TARGET_ROAS': {
      const roas = Number(draft.targetRoas);
      if (!Number.isFinite(roas) || roas <= 0) {
        throw new BadRequestException(
          'Enter a valid target ROAS for this bid strategy.',
        );
      }
      return { target_roas: { target_roas: roas } };
    }
    case 'TARGET_IMPRESSION_SHARE':
      return {
        target_impression_share: {
          location: enums.TargetImpressionShareLocation.ANYWHERE_ON_PAGE,
          location_fraction_micros: 500_000,
          cpc_bid_ceiling_micros: toMicros(10),
        },
      };
    case 'MAXIMIZE_CLICKS':
    default:
      return { target_spend: {} };
  }
}

export function buildCampaignBudgetPayloadFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleCampaignBudgetPayload {
  const dailyBudget = Number(draft.dailyBudget);
  if (!Number.isFinite(dailyBudget) || dailyBudget < 1) {
    throw new BadRequestException('Set a daily budget of at least $1.');
  }

  const nameBase = draft.campaignName?.trim() || 'Campaign';
  return {
    name: `${nameBase} Budget`,
    amountMicros: toMicros(dailyBudget),
    deliveryMethod: enums.BudgetDeliveryMethod.STANDARD,
    explicitlyShared: false,
  };
}

export function buildCampaignPayloadFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleCampaignCreatePayload {
  const name = draft.campaignName?.trim();
  if (!name) {
    throw new BadRequestException('Add a campaign name.');
  }

  if (draft.campaignType && draft.campaignType !== 'SEARCH') {
    throw new BadRequestException(
      `Publishing ${draft.campaignType} campaigns is not supported yet. Use Search.`,
    );
  }

  const networks = draft.networkSelection ?? [];
  const targetGoogleSearch =
    networks.length === 0 ||
    networks.some((row) => /google search/i.test(row));
  const targetSearchNetwork = networks.some((row) =>
    /search partners|search network/i.test(row),
  );
  const targetContentNetwork = networks.some((row) =>
    /display|content/i.test(row),
  );

  if (
    draft.containsEuPoliticalAdvertising !== true &&
    draft.containsEuPoliticalAdvertising !== false
  ) {
    throw new BadRequestException(
      'Confirm if your campaign has EU political ads.',
    );
  }

  return {
    name,
    status: enums.CampaignStatus.PAUSED,
    advertisingChannelType: enums.AdvertisingChannelType.SEARCH,
    bidding: mapBidding(draft),
    networkSettings: {
      targetGoogleSearch,
      targetSearchNetwork,
      targetContentNetwork,
    },
    containsEuPoliticalAdvertising: draft.containsEuPoliticalAdvertising
      ? enums.EuPoliticalAdvertisingStatus.CONTAINS_EU_POLITICAL_ADVERTISING
      : enums.EuPoliticalAdvertisingStatus
          .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
    startDate: yyyymmdd(draft.startDate),
    endDate: yyyymmdd(draft.endDate),
  };
}

export function buildAdGroupPayloadFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleAdGroupCreatePayload {
  const campaignName = draft.campaignName?.trim() || 'Campaign';
  return {
    name: `${campaignName} Ad group`,
    status: enums.AdGroupStatus.ENABLED,
    type: enums.AdGroupType.SEARCH_STANDARD,
  };
}

export function buildKeywordPayloadsFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleKeywordCreatePayload[] {
  const matchType = mapMatchType(draft.keywordMatchType);
  const suggested =
    draft.suggestedKeywords
      ?.filter((row) => row.enabled && row.text.trim())
      .map((row) => row.text.trim()) ?? [];
  const custom =
    draft.customKeywords?.map((row) => row.trim()).filter(Boolean) ?? [];

  const unique = [...new Set([...suggested, ...custom])];
  if (unique.length === 0) {
    const fallback =
      draft.businessName?.trim() ||
      draft.campaignName?.trim() ||
      draft.productsServices?.find((row) => row.trim())?.trim() ||
      'local business';
    return [{ text: fallback, matchType }];
  }

  return unique.map((text) => ({ text, matchType }));
}

export function buildNegativeKeywordPayloadsFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleKeywordCreatePayload[] {
  const negatives =
    draft.negativeKeywords?.map((row) => row.trim()).filter(Boolean) ?? [];
  return negatives.map((text) => ({
    text,
    matchType: enums.KeywordMatchType.BROAD,
  }));
}

export function buildResponsiveSearchAdPayloadFromDraft(
  draft: GoogleCampaignBuilderDraftData,
  ad?: GoogleAdCreativeDraftData,
): GoogleResponsiveSearchAdPayload {
  const creative = ad ?? draft.ads?.[0];
  if (!creative) {
    throw new BadRequestException('Create at least one ad.');
  }

  const headlines = creative.headlines
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 15)
    .map((text) => ({ text }));
  const descriptions = creative.descriptions
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((text) => ({ text }));

  if (headlines.length < 3) {
    throw new BadRequestException('Keep at least 3 headlines.');
  }
  if (descriptions.length < 2) {
    throw new BadRequestException('Keep at least 2 descriptions.');
  }

  const finalUrl = toDealiooPublicAdsFinalUrl(creative.finalUrl?.trim() || '');
  if (!finalUrl) {
    throw new BadRequestException('Add a valid final URL.');
  }

  return {
    finalUrls: [finalUrl],
    headlines,
    descriptions,
    path1: creative.path1?.trim() || undefined,
    path2: creative.path2?.trim() || undefined,
  };
}

const DEALIOO_PUBLIC_ORIGIN = (
  process.env.DEALIOO_PUBLIC_APP_URL ||
  process.env.FRONTEND_PUBLIC_URL ||
  'https://www.dealioo.io'
).replace(/\/$/, '');

function toDealiooPublicAdsFinalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isTunnel =
      host.includes('ngrok') ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.local');
    if (!isTunnel) return trimmed;
    return `${DEALIOO_PUBLIC_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

export function buildProximityPayloadsFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleProximityPayload[] {
  const payloads: GoogleProximityPayload[] = [];

  // Google Ads allows proximity (radius) only for INCLUDE targeting.
  // Excluded places must use negative location criteria, not negative proximity.
  const pushIncludeProximity = (location: {
    id?: string;
    name?: string;
    type?: string;
    latitude?: number;
    longitude?: number;
    radiusValue?: number;
    radiusUnit?: string;
  }) => {
    if (location.type === 'country') return;
    const latitude =
      typeof location.latitude === 'number' ? location.latitude : null;
    const longitude =
      typeof location.longitude === 'number' ? location.longitude : null;
    const radiusValue =
      typeof location.radiusValue === 'number' && location.radiusValue >= 1
        ? location.radiusValue
        : null;
    if (latitude == null || longitude == null || radiusValue == null) return;
    payloads.push({
      latitude,
      longitude,
      radiusValue,
      radiusUnit: location.radiusUnit === 'MILES' ? 'MILES' : 'KILOMETERS',
      centerLocationId: location.id?.trim() || undefined,
      addressLabel: location.name?.trim() || undefined,
      negative: false,
    });
  };

  for (const location of draft.targetLocations ?? []) {
    pushIncludeProximity(location);
  }

  if (payloads.length === 0) {
    const legacy = buildProximityPayloadFromDraft(draft);
    if (legacy) payloads.push({ ...legacy, negative: false });
  }

  return payloads;
}

export function buildProximityPayloadFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleProximityPayload | null {
  const center =
    draft.radiusCenter ??
    (draft.targetLocations ?? []).find(
      (row) => row.type !== 'country' && row.id?.trim(),
    ) ??
    null;

  const latitude =
    typeof draft.radiusLat === 'number'
      ? draft.radiusLat
      : typeof center?.latitude === 'number'
        ? center.latitude
        : null;
  const longitude =
    typeof draft.radiusLng === 'number'
      ? draft.radiusLng
      : typeof center?.longitude === 'number'
        ? center.longitude
        : null;

  const radiusValue =
    typeof draft.radiusValue === 'number' && draft.radiusValue >= 1
      ? draft.radiusValue
      : typeof center?.radiusValue === 'number' && center.radiusValue >= 1
        ? center.radiusValue
        : null;
  const radiusUnit =
    draft.radiusUnit === 'MILES' || center?.radiusUnit === 'MILES'
      ? 'MILES'
      : 'KILOMETERS';

  const pinNeedsRadius =
    center != null &&
    center.type !== 'country' &&
    latitude != null &&
    longitude != null;

  if (!draft.radiusEnabled && !pinNeedsRadius) {
    return null;
  }

  if (latitude == null || longitude == null || radiusValue == null) {
    return null;
  }

  return {
    latitude,
    longitude,
    radiusValue,
    radiusUnit,
    centerLocationId: center?.id?.trim() || undefined,
    addressLabel:
      center?.name?.trim() || draft.radiusTargeting?.trim() || undefined,
  };
}

export function buildGeoTargetPayloadsFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleGeoTargetPayload[] {
  const targets: GoogleGeoTargetPayload[] = [];
  const proximities = buildProximityPayloadsFromDraft(draft);
  // Cities already published as include proximity don't also need a location criterion.
  const skipPositiveIds = new Set(
    proximities
      .filter((row) => !row.negative && row.centerLocationId)
      .map((row) => row.centerLocationId as string),
  );

  for (const location of draft.targetLocations ?? []) {
    const id = location.id?.trim();
    const name = location.name?.trim();
    if (!id || !name) continue;
    if (skipPositiveIds.has(id)) continue;
    targets.push({
      rawId: id,
      name,
      type: location.type,
      negative: false,
    });
  }

  // Excludes are always place-based (Google rejects negative proximity/radius).
  for (const location of draft.excludedLocationTargets ?? []) {
    const id = location.id?.trim();
    const name = location.name?.trim();
    if (!id || !name) continue;
    targets.push({
      rawId: id,
      name,
      type: location.type,
      negative: true,
    });
  }

  if (
    !targets.some((row) => !row.negative) &&
    !proximities.some((row) => !row.negative)
  ) {
    throw new BadRequestException('Select at least one target location.');
  }

  return targets;
}

export function isGoogleGeoCriterionId(rawId: string): boolean {
  return /^\d+$/.test(rawId.trim());
}

export function buildLanguageCriterionIdsFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): string[] {
  const ids = new Set<string>();
  for (const language of draft.languages ?? []) {
    const key = language.trim().toLowerCase();
    const mapped = LANGUAGE_CRITERION_IDS[key];
    if (mapped) ids.add(mapped);
  }
  if (ids.size === 0) {
    ids.add(LANGUAGE_CRITERION_IDS.english);
  }
  return [...ids];
}

export function extractGoogleResourceId(
  resourceName: string | null | undefined,
): string | null {
  const trimmed = resourceName?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/');
  const last = parts[parts.length - 1]?.trim();
  return last || null;
}

export function googleAdsCampaignConsoleUrl(
  customerId: string,
  campaignId: string,
): string {
  const cid = customerId.replace(/\D/g, '');
  return `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}&ocid=${encodeURIComponent(cid)}`;
}
