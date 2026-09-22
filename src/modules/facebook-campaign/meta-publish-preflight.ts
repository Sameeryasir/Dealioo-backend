import { BadRequestException } from '@nestjs/common';
import type { AdCreativeStepDataDto } from './dto/ad-creative-step-data.dto';
import type { AdSetStepDataDto } from './dto/adset-step-data.dto';
import type { CampaignStepDataDto } from './dto/meta-campaign-draft-response.dto';
import {
  assertAdCreativeDestinationUrl,
  assertAdCreativeMedia,
} from './meta-ad-creative-draft-validation';
import {
  assertAtLeastOnePlacement,
  assertAudienceCityRadius,
  assertOptimizationGoalForObjective,
  assertScheduleOrder,
} from './meta-adset-draft-validation';
import {
  MetaCampaignObjective,
  MetaOptimizationGoal,
} from './meta-campaign.constants';

export function optimizationGoalNeedsPixel(
  optimizationGoal: string | null | undefined,
  objective?: string | null,
): boolean {
  const goal = String(optimizationGoal ?? '').trim();
  const campaignObjective = String(objective ?? '').trim();
  if (
    goal === MetaOptimizationGoal.OFFSITE_CONVERSIONS ||
    goal === MetaOptimizationGoal.VALUE
  ) {
    return true;
  }
  if (goal === MetaOptimizationGoal.LANDING_PAGE_VIEWS) {
    return campaignObjective !== MetaCampaignObjective.OUTCOME_TRAFFIC;
  }
  return false;
}

export function optimizationGoalNeedsConversionEvent(
  optimizationGoal: string | null | undefined,
): boolean {
  const goal = String(optimizationGoal ?? '').trim();
  return (
    goal === MetaOptimizationGoal.OFFSITE_CONVERSIONS ||
    goal === MetaOptimizationGoal.VALUE
  );
}

const META_CUSTOM_EVENT_ALIASES: Record<string, string> = {
  VIEW_CONTENT: 'CONTENT_VIEW',
  VIEWCONTENT: 'CONTENT_VIEW',
  INITIATE_CHECKOUT: 'INITIATED_CHECKOUT',
  COMPLETE_REGISTRATION: 'COMPLETE_REGISTRATION',
};

const CONVERSION_EVENTS_BY_OBJECTIVE: Partial<
  Record<MetaCampaignObjective, readonly string[]>
> = {
  [MetaCampaignObjective.OUTCOME_LEADS]: [
    'LEAD',
    'COMPLETE_REGISTRATION',
    'CONTACT',
    'FIND_LOCATION',
    'SCHEDULE',
    'START_TRIAL',
    'SUBMIT_APPLICATION',
    'SUBSCRIBE',
  ],
  [MetaCampaignObjective.OUTCOME_SALES]: [
    'PURCHASE',
    'INITIATED_CHECKOUT',
    'ADD_PAYMENT_INFO',
    'ADD_TO_CART',
    'COMPLETE_REGISTRATION',
    'DONATE',
    'START_TRIAL',
    'SUBSCRIBE',
    'CONTENT_VIEW',
  ],
};

export function normalizeMetaCustomEventType(
  raw: string | null | undefined,
): string {
  const trimmed = String(raw ?? '').trim().toUpperCase();
  if (!trimmed) return '';
  return META_CUSTOM_EVENT_ALIASES[trimmed] ?? trimmed;
}

export function allowedConversionEventsForObjective(
  objective: string | null | undefined,
): readonly string[] {
  const key = String(objective ?? '').trim() as MetaCampaignObjective;
  return CONVERSION_EVENTS_BY_OBJECTIVE[key] ?? [];
}

export function buildMetaPromotedObjectForGoal(
  optimizationGoal: string | null | undefined,
  promotedObject?: {
    pixelId?: string | null;
    customEventType?: string | null;
    pageId?: string | null;
  } | null,
  objective?: string | null,
): Record<string, string> | undefined {
  const goal = String(optimizationGoal ?? '').trim();
  const pixelId = promotedObject?.pixelId?.trim() || '';
  const customEventType = normalizeMetaCustomEventType(
    promotedObject?.customEventType,
  );
  const campaignObjective = String(objective ?? '').trim();

  if (
    goal === MetaOptimizationGoal.OFFSITE_CONVERSIONS ||
    goal === MetaOptimizationGoal.VALUE
  ) {
    if (!pixelId || !customEventType) return undefined;
    const eventForGoal =
      goal === MetaOptimizationGoal.VALUE ? 'PURCHASE' : customEventType;
    const allowed = allowedConversionEventsForObjective(campaignObjective);
    if (allowed.length > 0 && !allowed.includes(eventForGoal)) {
      return undefined;
    }
    return {
      pixel_id: pixelId,
      custom_event_type: eventForGoal,
    };
  }

  if (goal === MetaOptimizationGoal.LANDING_PAGE_VIEWS) {
    if (campaignObjective === MetaCampaignObjective.OUTCOME_TRAFFIC) {
      return undefined;
    }
    if (!pixelId) return undefined;
    return {
      pixel_id: pixelId,
      custom_event_type: 'CONTENT_VIEW',
    };
  }

  return undefined;
}

export function normalizeDraftPromotedObject(
  optimizationGoal: string | null | undefined,
  promotedObject?: {
    pixelId?: string | null;
    customEventType?: string | null;
    pageId?: string | null;
  } | null,
  objective?: string | null,
):
  | {
      pixelId?: string;
      customEventType?: string;
      pageId?: string;
    }
  | undefined {
  const goal = String(optimizationGoal ?? '').trim();
  const campaignObjective = String(objective ?? '').trim();
  const pixelId = promotedObject?.pixelId?.trim() || '';
  const customEventType = normalizeMetaCustomEventType(
    promotedObject?.customEventType,
  );
  const pageId = promotedObject?.pageId?.trim() || '';

  if (
    goal === MetaOptimizationGoal.OFFSITE_CONVERSIONS ||
    goal === MetaOptimizationGoal.VALUE
  ) {
    if (!pixelId) return undefined;
    return {
      pixelId,
      ...(customEventType ? { customEventType } : {}),
    };
  }

  if (goal === MetaOptimizationGoal.LANDING_PAGE_VIEWS) {
    if (campaignObjective === MetaCampaignObjective.OUTCOME_TRAFFIC) {
      return undefined;
    }
    if (!pixelId) return undefined;
    return { pixelId };
  }

  if (pageId) {
    return { pageId };
  }

  return undefined;
}

export function assertPublishReady(
  campaign: CampaignStepDataDto,
  adSet: AdSetStepDataDto,
  creative: AdCreativeStepDataDto,
): void {
  if (!campaign?.name?.trim()) {
    throw new BadRequestException('Campaign name is required before publishing.');
  }
  if (!campaign.objective) {
    throw new BadRequestException('Campaign objective is required before publishing.');
  }
  if (!Array.isArray(campaign.specialAdCategories)) {
    throw new BadRequestException('Special ad categories are required before publishing.');
  }

  if (!adSet?.name?.trim()) {
    throw new BadRequestException('Ad set name is required before publishing.');
  }

  const hasIncludedLocation =
    Boolean(adSet.audience?.country?.trim()) ||
    (Array.isArray(adSet.audience?.locations) &&
      adSet.audience.locations.some((row) => {
        const mode = String((row as { mode?: string }).mode ?? 'include');
        return mode !== 'exclude';
      }));

  if (!hasIncludedLocation) {
    throw new BadRequestException(
      'Add at least one included location before publishing.',
    );
  }

  if (
    typeof adSet.audience?.ageMin === 'number' &&
    typeof adSet.audience?.ageMax === 'number' &&
    adSet.audience.ageMin > adSet.audience.ageMax
  ) {
    throw new BadRequestException('Minimum age cannot exceed maximum age.');
  }

  assertAudienceCityRadius(
    adSet.audience?.city,
    adSet.audience?.radius,
    adSet.audience?.distanceUnit,
  );

  assertOptimizationGoalForObjective(
    campaign.objective as MetaCampaignObjective,
    adSet.optimizationGoal as MetaOptimizationGoal,
  );

  assertAtLeastOnePlacement(adSet.placements);

  if (!campaign.campaignBudgetOptimization) {
    const hasDaily =
      adSet.budgetType === 'daily' &&
      ((adSet.dailyBudget != null && adSet.dailyBudget >= 1) ||
        Boolean(adSet.dailyBudgetMinor));
    const hasLifetime =
      adSet.budgetType === 'lifetime' &&
      ((adSet.lifetimeBudget != null && adSet.lifetimeBudget >= 1) ||
        Boolean(adSet.lifetimeBudgetMinor));
    if (!hasDaily && !hasLifetime) {
      throw new BadRequestException(
        'Ad set budget is required before publishing when Campaign budget is off.',
      );
    }
  }

  if (!adSet.startDateTime?.trim()) {
    throw new BadRequestException('Ad set schedule start is required before publishing.');
  }
  assertScheduleOrder(adSet.startDateTime, adSet.endDateTime);

  if (optimizationGoalNeedsPixel(adSet.optimizationGoal, campaign.objective)) {
    if (!adSet.promotedObject?.pixelId?.trim()) {
      throw new BadRequestException(
        'Select a Dataset (Meta Pixel) before publishing this performance goal.',
      );
    }
    if (optimizationGoalNeedsConversionEvent(adSet.optimizationGoal)) {
      const eventType = normalizeMetaCustomEventType(
        adSet.promotedObject?.customEventType,
      );
      if (!eventType) {
        throw new BadRequestException(
          'Select a conversion event before publishing this performance goal. Landing page views only need a Dataset — conversions/value need Dataset + event.',
        );
      }
      const eventForGoal =
        adSet.optimizationGoal === MetaOptimizationGoal.VALUE
          ? 'PURCHASE'
          : eventType;
      const allowed = allowedConversionEventsForObjective(campaign.objective);
      if (allowed.length > 0 && !allowed.includes(eventForGoal)) {
        throw new BadRequestException(
          `Conversion event "${eventForGoal}" is not valid for this campaign objective. Choose one of: ${allowed.join(', ')}.`,
        );
      }
    }
  }

  if (!creative?.name?.trim()) {
    throw new BadRequestException('Ad name is required before publishing.');
  }
  if (!creative.facebookPageId?.trim()) {
    throw new BadRequestException(
      'Select a Facebook Page before publishing.',
    );
  }
  if (!creative.primaryText?.trim()) {
    throw new BadRequestException('Primary text is required before publishing.');
  }

  assertAdCreativeMedia(creative as never);
  assertAdCreativeDestinationUrl(creative as never);
}

export function humanizeMetaPublishDetail(detail: string): string {
  const raw = detail.trim();
  const lower = raw.toLowerCase();

  if (
    lower.includes('permission') ||
    lower.includes('(#200)') ||
    lower.includes('oauth')
  ) {
    return `${raw} Reconnect Meta Ads in Settings → Integrations and grant the required permissions.`;
  }
  if (lower.includes('token') && lower.includes('expired')) {
    return `${raw} Reconnect Meta Ads so Dealioo can publish with a fresh token.`;
  }
  if (lower.includes('pixel') || lower.includes('promoted_object')) {
    return `${raw} For Traffic + Landing page views, do not attach a Dataset as promoted object. For Leads/Sales conversions, use Dataset + a valid conversion event (no Facebook Page in promoted object).`;
  }
  if (lower.includes('targeting') || lower.includes('geo_locations')) {
    return `${raw} Check included locations and age range on the Ad set step.`;
  }
  if (
    lower.includes('image') ||
    lower.includes('video') ||
    lower.includes('creative') ||
    lower.includes('link_data')
  ) {
    return `${raw} Check the ad creative media and landing page URL (must be HTTPS).`;
  }
  if (lower.includes('budget')) {
    return `${raw} Check campaign/ad set budget amounts (minimum 1.00 in account currency).`;
  }
  if (lower.includes('page')) {
    return `${raw} Confirm the selected Facebook Page is still available on this Meta account.`;
  }

  return raw;
}
