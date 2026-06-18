import { BadRequestException } from '@nestjs/common';
import { AdCreativeStepDataDto } from './dto/ad-creative-step-data.dto';
import { AdSetPlacementsDto, AdSetStepDataDto } from './dto/adset-step-data.dto';
import { CampaignStepDataDto } from './dto/meta-campaign-draft-response.dto';
import {
  MetaCreativeFormat,
  MetaGender,
} from './meta-campaign.constants';
import { budgetToMetaMinorUnits } from './meta-adset-draft-validation';
import {
  buildCampaignPayload,
  buildCreativePayload,
  genderToMetaGenders,
  toMetaUnixTime,
} from './facebook-campaign-meta';

type DraftLocationTarget = {
  mode?: 'include' | 'exclude';
  type?: 'country' | 'address';
  countryCode?: string;
  label?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  distanceUnit?: string;
};

export function draftDateTimeToUnix(dateTime: string): number {
  const iso = dateTime.split(' (')[0].trim();
  return toMetaUnixTime(iso);
}

export function buildCampaignPayloadFromDraft(campaign: CampaignStepDataDto) {
  const cboEnabled = campaign.campaignBudgetOptimization;

  let campaignDailyBudgetMinor: string | undefined;
  let campaignLifetimeBudgetMinor: string | undefined;

  if (cboEnabled) {
    if (campaign.campaignBudgetType === 'lifetime' && campaign.campaignLifetimeBudget) {
      campaignLifetimeBudgetMinor = budgetToMetaMinorUnits(
        campaign.campaignLifetimeBudget,
      );
    } else if (campaign.campaignDailyBudget) {
      campaignDailyBudgetMinor = budgetToMetaMinorUnits(
        campaign.campaignDailyBudget,
      );
    }
  }

  let campaignSpendLimitMinor: string | undefined;
  if (campaign.campaignSpendLimit) {
    campaignSpendLimitMinor = budgetToMetaMinorUnits(campaign.campaignSpendLimit);
  }

  return buildCampaignPayload({
    name: campaign.name,
    objective: campaign.objective,
    buyingType: campaign.buyingType,
    status: campaign.status,
    specialAdCategories: campaign.specialAdCategories ?? [],
    campaignBudgetOptimization: cboEnabled,
    campaignDailyBudgetMinor,
    campaignLifetimeBudgetMinor,
    campaignBidStrategy: campaign.campaignBidStrategy,
    campaignSpendLimitMinor,
  });
}

export function buildPlacementSpecFromDraft(placements: AdSetPlacementsDto): {
  publisher_platforms: string[];
  facebook_positions: string[];
  instagram_positions: string[];
  device_platforms: string[];
  useAdvantagePlus: boolean;
} {
  if (placements.advantagePlusPlacements) {
    return {
      publisher_platforms: [],
      facebook_positions: [],
      instagram_positions: [],
      device_platforms: [],
      useAdvantagePlus: true,
    };
  }

  const publisherPlatforms = new Set<string>();
  const facebookPositions: string[] = [];
  const instagramPositions: string[] = [];
  const devicePlatforms: string[] = [];

  if (placements.devicePlatforms.mobile) devicePlatforms.push('mobile');
  if (placements.devicePlatforms.desktop) devicePlatforms.push('desktop');

  if (placements.publisherPlatforms.facebook) publisherPlatforms.add('facebook');
  if (placements.publisherPlatforms.instagram) publisherPlatforms.add('instagram');
  if (placements.publisherPlatforms.audienceNetwork) {
    publisherPlatforms.add('audience_network');
  }
  if (placements.publisherPlatforms.messenger) publisherPlatforms.add('messenger');

  if (placements.facebookPositions.feed) facebookPositions.push('feed');
  if (placements.facebookPositions.story) facebookPositions.push('story');
  if (placements.facebookPositions.reels) facebookPositions.push('facebook_reels');
  if (placements.facebookPositions.marketplace) {
    facebookPositions.push('marketplace');
  }
  if (placements.facebookPositions.videoFeeds) {
    facebookPositions.push('video_feeds');
  }
  if (placements.facebookPositions.rightHandColumn) {
    facebookPositions.push('right_hand_column');
  }

  if (placements.instagramPositions.stream) instagramPositions.push('stream');
  if (placements.instagramPositions.story) instagramPositions.push('story');
  if (placements.instagramPositions.reels) instagramPositions.push('reels');
  if (placements.instagramPositions.explore) instagramPositions.push('explore');

  if (publisherPlatforms.size === 0) {
    throw new BadRequestException('Select at least one publisher platform.');
  }

  return {
    publisher_platforms: [...publisherPlatforms],
    facebook_positions: [...new Set(facebookPositions)],
    instagram_positions: [...new Set(instagramPositions)],
    device_platforms: devicePlatforms.length ? devicePlatforms : ['mobile', 'desktop'],
    useAdvantagePlus: false,
  };
}

function buildGeoFromAudience(audience: AdSetStepDataDto['audience']) {
  const locations = (audience.locations ?? []) as DraftLocationTarget[];

  const includedCountries = new Set<string>();
  const includedCustom: Array<Record<string, unknown>> = [];
  const excludedCountries = new Set<string>();
  const excludedCustom: Array<Record<string, unknown>> = [];

  for (const loc of locations) {
    const mode = loc.mode ?? 'include';
    const countryCode = loc.countryCode?.toUpperCase();

    if (loc.type === 'country' && countryCode) {
      if (mode === 'exclude') excludedCountries.add(countryCode);
      else includedCountries.add(countryCode);
      continue;
    }

    if (
      loc.type === 'address' &&
      loc.latitude != null &&
      loc.longitude != null &&
      loc.radius
    ) {
      const entry = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        radius: loc.radius,
        distance_unit: loc.distanceUnit ?? 'kilometer',
      };
      if (mode === 'exclude') excludedCustom.push(entry);
      else includedCustom.push(entry);
      if (countryCode) includedCountries.add(countryCode);
    }
  }

  if (!includedCountries.size && audience.country) {
    includedCountries.add(audience.country.toUpperCase());
  }

  const geoLocations: Record<string, unknown> = {};
  if (includedCountries.size) {
    geoLocations.countries = [...includedCountries];
  }
  if (includedCustom.length) {
    geoLocations.custom_locations = includedCustom;
  }

  const excludedGeo: Record<string, unknown> = {};
  if (excludedCountries.size) {
    excludedGeo.countries = [...excludedCountries];
  }
  if (excludedCustom.length) {
    excludedGeo.custom_locations = excludedCustom;
  }

  return { geoLocations, excludedGeo };
}

export function buildAdSetPayloadFromDraft(
  campaign: CampaignStepDataDto,
  adSet: AdSetStepDataDto,
  metaCampaignId: string,
) {
  const cboEnabled = campaign.campaignBudgetOptimization;
  const placementSpec = buildPlacementSpecFromDraft(adSet.placements);
  const { geoLocations, excludedGeo } = buildGeoFromAudience(adSet.audience);

  const targeting: Record<string, unknown> = {
    geo_locations: geoLocations,
    age_min: adSet.audience.ageMin,
    age_max: adSet.audience.ageMax,
    targeting_automation: { advantage_audience: 1 },
  };

  if (Object.keys(excludedGeo).length) {
    targeting.excluded_geo_locations = excludedGeo;
  }

  if (!placementSpec.useAdvantagePlus) {
    targeting.publisher_platforms = placementSpec.publisher_platforms;
    if (placementSpec.facebook_positions.length) {
      targeting.facebook_positions = placementSpec.facebook_positions;
    }
    if (placementSpec.instagram_positions.length) {
      targeting.instagram_positions = placementSpec.instagram_positions;
    }
    targeting.device_platforms = placementSpec.device_platforms;
  }

  const genders = genderToMetaGenders(adSet.audience.gender as MetaGender);
  if (genders?.length) {
    targeting.genders = genders;
  }

  const body: Record<string, unknown> = {
    name: adSet.name,
    campaign_id: metaCampaignId,
    billing_event: adSet.billingEvent,
    optimization_goal: adSet.optimizationGoal,
    bid_strategy: adSet.bidStrategy,
    destination_type: adSet.destinationType,
    is_adset_budget_sharing_enabled: cboEnabled,
    targeting,
    start_time: draftDateTimeToUnix(adSet.startDateTime),
    end_time: draftDateTimeToUnix(adSet.endDateTime),
    status: adSet.status,
  };

  if (!cboEnabled) {
    if (adSet.dailyBudgetMinor) {
      body.daily_budget = adSet.dailyBudgetMinor;
    } else if (adSet.lifetimeBudgetMinor) {
      body.lifetime_budget = adSet.lifetimeBudgetMinor;
    }
  }

  if (adSet.bidAmount && adSet.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP') {
    body.bid_amount = Math.round(adSet.bidAmount * 100);
  }

  if (adSet.promotedObject?.pixelId) {
    body.promoted_object = {
      pixel_id: adSet.promotedObject.pixelId,
      custom_event_type: adSet.promotedObject.customEventType || undefined,
      page_id: adSet.promotedObject.pageId || undefined,
    };
  }

  return body;
}

export function buildCreativePayloadFromDraft(
  creative: AdCreativeStepDataDto,
  media: {
    imageHash?: string;
    videoId?: string;
    carouselHashes?: string[];
  },
  destinationUrl: string,
) {
  if (creative.creativeFormat === MetaCreativeFormat.CAROUSEL) {
    const cards = creative.carouselCards ?? [];
    const childAttachments = cards.map((card, index) => {
      const hash = media.carouselHashes?.[index];
      if (!hash) {
        throw new BadRequestException(`Missing image hash for carousel card ${index + 1}.`);
      }
      return {
        link: card.destinationUrl,
        image_hash: hash,
        name: card.headline,
        description: card.description?.trim() || undefined,
        call_to_action: {
          type: card.callToAction,
          value: { link: card.destinationUrl },
        },
      };
    });

    const objectStorySpec: Record<string, unknown> = {
      page_id: creative.facebookPageId,
      link_data: {
        link: cards[0]?.destinationUrl ?? destinationUrl,
        message: creative.primaryText,
        child_attachments: childAttachments,
      },
    };

    if (creative.instagramActorId?.trim()) {
      objectStorySpec.instagram_actor_id = creative.instagramActorId.trim();
    }

    return {
      name: `${creative.name} Creative`,
      object_story_spec: objectStorySpec,
    };
  }

  return buildCreativePayload({
    pageId: creative.facebookPageId,
    instagramActorId: creative.instagramActorId,
    imageHash: media.imageHash,
    videoId: media.videoId,
    destinationUrl,
    primaryText: creative.primaryText,
    headline: creative.headline ?? creative.name,
    description: creative.description,
    callToAction: creative.callToAction ?? 'LEARN_MORE',
    name: `${creative.name} Creative`,
  });
}

export function buildAdPayloadFromDraft(
  creative: AdCreativeStepDataDto,
  metaAdsetId: string,
  metaCreativeId: string,
) {
  return {
    name: creative.name,
    adset_id: metaAdsetId,
    creative: { creative_id: metaCreativeId },
    status: creative.status,
  };
}
