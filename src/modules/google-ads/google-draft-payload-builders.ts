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

const LANGUAGE_CRITERION_IDS: Record<string, string> = {
  english: '1000',
  german: '1001',
  french: '1002',
  spanish: '1003',
  italian: '1004',
  japanese: '1005',
  dutch: '1010',
  portuguese: '1014',
  chinese: '1017',
  arabic: '1019',
  hindi: '1023',
  russian: '1031',
  turkish: '1037',
  urdu: '1041',
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
    throw new BadRequestException('Keep or add at least one keyword.');
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

  const finalUrl = creative.finalUrl?.trim();
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

export function buildGeoTargetPayloadsFromDraft(
  draft: GoogleCampaignBuilderDraftData,
): GoogleGeoTargetPayload[] {
  const targets: GoogleGeoTargetPayload[] = [];

  for (const location of draft.targetLocations ?? []) {
    const id = location.id?.trim();
    const name = location.name?.trim();
    if (!id || !name) continue;
    targets.push({
      rawId: id,
      name,
      type: location.type,
      negative: false,
    });
  }

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

  if (!targets.some((row) => !row.negative)) {
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
