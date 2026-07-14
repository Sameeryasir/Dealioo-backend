import { readFileSync } from 'fs';
import { BadRequestException } from '@nestjs/common';
import {
  logMetaApiRequest,
  logMetaApiResponse,
  logMetaPublishStep,
} from './meta-publish-trace';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  normalizeCampaignImageUrlForMeta,
  resolveLocalUploadFilePath,
} from '../../utils/disk-file-upload-multer';
import { mapMetaMarketingApiError } from '../facebook/facebook-meta-token.service';
import { CreateFacebookCampaignDto } from './dto/create-facebook-campaign.dto';
import { MetaPlacementsDto } from './dto/create-facebook-campaign.dto';
import {
  MetaCampaignObjective,
  MetaCreationStep,
  MetaGender,
} from './meta-campaign.constants';

// Changed: Graph API v24.0 for campaign publish / Marketing API calls.
const FACEBOOK_GRAPH = 'https://graph.facebook.com/v24.0';

type GraphErrorBody = {
  error?: {
    message?: string;
    error_user_msg?: string;
    code?: number;
  };
};

export class MetaApiStepError extends BadRequestException {
  constructor(
    public readonly step: MetaCreationStep,
    public readonly metaErrorCode: number | null,
    public readonly metaErrorMessage: string,
    public readonly rawResponse: string,
    userMessage?: string,
  ) {
    super(userMessage ?? metaErrorMessage);
  }
}

export function normalizeAdAccountId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BadRequestException('Ad account id is required.');
  }
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

export function dailyBudgetToMetaMinorUnits(dollars: number): string {
  const cents = Math.round(dollars * 100);
  if (cents < 100) {
    throw new BadRequestException(
      'Daily budget must be at least 1.00 in account currency.',
    );
  }
  return String(cents);
}

export function toMetaUnixTime(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('Invalid schedule date.');
  }
  return Math.floor(parsed / 1000);
}

export function assertScheduleRange(startDate: string, endDate: string): void {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new BadRequestException('Start and end dates are required.');
  }
  if (end <= start) {
    throw new BadRequestException('End date must be after start date.');
  }
}

export function assertAgeRange(ageMin: number, ageMax: number): void {
  if (ageMin > ageMax) {
    throw new BadRequestException('Minimum age cannot exceed maximum age.');
  }
}

export function assertMediaProvided(dto: CreateFacebookCampaignDto): void {
  const hasImage = Boolean(dto.imageUrl?.trim());
  const hasVideo = Boolean(dto.videoUrl?.trim());
  if (hasImage === hasVideo) {
    throw new BadRequestException('Provide either an image URL or a video URL.');
  }
}

export function genderToMetaGenders(gender: MetaGender): number[] | undefined {
  if (gender === MetaGender.MALE) return [1];
  if (gender === MetaGender.FEMALE) return [2];
  return undefined;
}

export function optimizationGoalForObjective(objective: MetaCampaignObjective): string {
  switch (objective) {
    case MetaCampaignObjective.OUTCOME_LEADS:
      return 'LEAD_GENERATION';
    case MetaCampaignObjective.OUTCOME_TRAFFIC:
      return 'LINK_CLICKS';
    case MetaCampaignObjective.OUTCOME_SALES:
      return 'OFFSITE_CONVERSIONS';
    case MetaCampaignObjective.OUTCOME_ENGAGEMENT:
      return 'POST_ENGAGEMENT';
    case MetaCampaignObjective.OUTCOME_AWARENESS:
    default:
      return 'REACH';
  }
}

export function buildCampaignPayload(input: {
  name: string;
  objective: MetaCampaignObjective | string;
  buyingType?: string;
  status?: string;
  specialAdCategories?: string[];
  campaignBudgetOptimization?: boolean;
  campaignDailyBudgetMinor?: string;
  campaignLifetimeBudgetMinor?: string;
  campaignSpendLimitMinor?: string;
  campaignBidStrategy?: string;
}) {
  const body: Record<string, unknown> = {
    name: input.name,
    objective: input.objective,
    buying_type: input.buyingType ?? 'AUCTION',
    status: input.status ?? 'PAUSED',
    special_ad_categories: input.specialAdCategories ?? [],
    is_adset_budget_sharing_enabled: false,
  };

  if (input.campaignBudgetOptimization) {
    if (input.campaignDailyBudgetMinor) {
      body.daily_budget = input.campaignDailyBudgetMinor;
    }
    if (input.campaignLifetimeBudgetMinor) {
      body.lifetime_budget = input.campaignLifetimeBudgetMinor;
    }
    if (input.campaignBidStrategy) {
      body.bid_strategy = input.campaignBidStrategy;
    }
  }

  if (input.campaignSpendLimitMinor) {
    body.spend_cap = input.campaignSpendLimitMinor;
  }

  return body;
}

type AdSetBuildInput = {
  name: string;
  campaignId: string;
  dailyBudgetMinor: string;
  objective: MetaCampaignObjective;
  startTime: number;
  endTime: number;
  country: string;
  cityKey?: string;
  radius?: number;
  distanceUnit?: string;
  ageMin: number;
  ageMax: number;
  genders?: number[];
  placements: MetaPlacementsDto;
};

export function buildPlacementSpec(placements: MetaPlacementsDto): {
  publisher_platforms: string[];
  facebook_positions: string[];
  instagram_positions: string[];
  device_platforms: string[];
} {
  const publisherPlatforms = new Set<string>();
  const facebookPositions: string[] = [];
  const instagramPositions: string[] = [];

  if (placements.facebookFeed) {
    publisherPlatforms.add('facebook');
    facebookPositions.push('feed');
  }
  if (placements.facebookStories) {
    publisherPlatforms.add('facebook');
    facebookPositions.push('story');
  }
  if (placements.instagramFeed) {
    publisherPlatforms.add('instagram');
    instagramPositions.push('stream');
  }
  if (placements.instagramStories) {
    publisherPlatforms.add('instagram');
    instagramPositions.push('story');
  }
  if (placements.reels) {
    publisherPlatforms.add('instagram');
    publisherPlatforms.add('facebook');
    instagramPositions.push('reels');
    facebookPositions.push('facebook_reels');
  }

  if (publisherPlatforms.size === 0) {
    throw new BadRequestException('Select at least one ad placement.');
  }

  return {
    publisher_platforms: [...publisherPlatforms],
    facebook_positions: [...new Set(facebookPositions)],
    instagram_positions: [...new Set(instagramPositions)],
    device_platforms: ['mobile', 'desktop'],
  };
}

export function buildAdSetPayload(input: AdSetBuildInput) {
  const placementSpec = buildPlacementSpec(input.placements);

  const geoLocations: Record<string, unknown> = {
    countries: [input.country.toUpperCase()],
  };

  if (input.cityKey && input.radius && input.distanceUnit) {
    geoLocations.cities = [
      {
        key: input.cityKey,
        radius: input.radius,
        distance_unit: input.distanceUnit,
      },
    ];
  }

  const targeting: Record<string, unknown> = {
    geo_locations: geoLocations,
    age_min: input.ageMin,
    age_max: input.ageMax,
    publisher_platforms: placementSpec.publisher_platforms,
    facebook_positions: placementSpec.facebook_positions,
    instagram_positions: placementSpec.instagram_positions,
    device_platforms: placementSpec.device_platforms,
  };

  if (input.genders?.length) {
    targeting.genders = input.genders;
  }

  return {
    name: input.name,
    campaign_id: input.campaignId,
    daily_budget: input.dailyBudgetMinor,
    billing_event: 'IMPRESSIONS',
    optimization_goal: optimizationGoalForObjective(input.objective),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: 'WEBSITE',
    is_adset_budget_sharing_enabled: false,
    targeting,
    start_time: input.startTime,
    end_time: input.endTime,
    status: 'PAUSED',
  };
}

type CreativeBuildInput = {
  pageId: string;
  instagramActorId?: string;
  imageHash?: string;
  videoId?: string;
  destinationUrl: string;
  primaryText: string;
  headline: string;
  description?: string;
  callToAction: string;
  name: string;
};

export function buildCreativePayload(input: CreativeBuildInput) {
  const callToAction = {
    type: input.callToAction,
    value: { link: input.destinationUrl },
  };

  const objectStorySpec: Record<string, unknown> = {
    page_id: input.pageId,
  };

  if (input.instagramActorId?.trim()) {
    objectStorySpec.instagram_actor_id = input.instagramActorId.trim();
  }

  if (input.videoId) {
    objectStorySpec.video_data = {
      video_id: input.videoId,
      message: input.primaryText,
      title: input.headline,
      link_description: input.description?.trim() || undefined,
      call_to_action: callToAction,
    };
  } else {
    objectStorySpec.link_data = {
      image_hash: input.imageHash,
      link: input.destinationUrl,
      message: input.primaryText,
      name: input.headline,
      description: input.description?.trim() || undefined,
      call_to_action: callToAction,
    };
  }

  return {
    name: input.name,
    object_story_spec: objectStorySpec,
  };
}

export function buildAdPayload(input: {
  name: string;
  adsetId: string;
  creativeId: string;
}) {
  return {
    name: input.name,
    adset_id: input.adsetId,
    creative: { creative_id: input.creativeId },
    status: 'PAUSED',
  };
}

export function adsManagerCampaignsUrl(adAccountId: string): string {
  const numeric = adAccountId.replace(/^act_/, '');
  return `https://www.facebook.com/adsmanager/manage/campaigns?act=${numeric}`;
}

function toMetaFormBody(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'boolean') {
      params.set(key, value ? 'true' : 'false');
      continue;
    }
    if (typeof value === 'object') {
      params.set(key, JSON.stringify(value));
      continue;
    }
    params.set(key, String(value));
  }

  return params;
}

export async function graphPostWithToken<T extends { id?: string }>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  step: MetaCreationStep = 'campaign',
): Promise<T> {
  const parsed = await graphPostMeta<T>(path, accessToken, body, step);

  if (!parsed.id) {
    throw new MetaApiStepError(
      step,
      null,
      'Facebook did not return an id for this step.',
      JSON.stringify(parsed),
      'Facebook did not return an id for this step.',
    );
  }

  return parsed;
}

type MetaAdImagesResponse = {
  images?: Record<string, { hash?: string; url?: string }>;
};

type MetaAdVideosResponse = {
  id?: string;
};

const META_IMAGE_EXT = /\.(jpe?g|png|gif|webp)(\?.*)?$/i;
const META_VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?.*)?$/i;

function isFolderUploadPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  if (!path) return true;
  if (path.endsWith('/uploads')) return true;
  if (path.endsWith('/backend/uploads')) return true;
  return false;
}

export function assertDirectMetaImageUrl(imageUrl: string): void {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    throw new BadRequestException('Image URL is required.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new BadRequestException('Image URL is not valid.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new BadRequestException(
      'Image URL must use HTTPS so Meta can download the file.',
    );
  }

  const path = parsedUrl.pathname.replace(/\/+$/, '');
  if (isFolderUploadPath(path) || !META_IMAGE_EXT.test(path)) {
    throw new BadRequestException(
      'Upload an ad image or use a direct HTTPS link to a .jpg/.png file (not a folder).',
    );
  }
}

export function assertDirectMetaVideoUrl(videoUrl: string): void {
  const trimmed = videoUrl.trim();
  if (!trimmed) {
    throw new BadRequestException('Video URL is required.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new BadRequestException('Video URL is not valid.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new BadRequestException(
      'Video URL must use HTTPS so Meta can download the file.',
    );
  }

  const path = parsedUrl.pathname.replace(/\/+$/, '');
  if (isFolderUploadPath(path) || !META_VIDEO_EXT.test(path)) {
    throw new BadRequestException(
      'Upload a video or use a direct HTTPS link to a .mp4/.mov file.',
    );
  }
}

function extractAdImageHashFromResponse(
  response: MetaAdImagesResponse,
): string {
  const hash = Object.values(response.images ?? {}).find(
    (row) => row.hash?.trim(),
  )?.hash?.trim();

  if (!hash) {
    throw new MetaApiStepError(
      'media',
      null,
      'Meta could not process the image.',
      JSON.stringify(response),
      'Meta could not process the ad image. Try uploading again or use a direct HTTPS link.',
    );
  }

  return hash;
}

export async function uploadAdImageHash(
  adAccountId: string,
  accessToken: string,
  imageUrl: string,
): Promise<string> {
  const trimmed =
    normalizeCampaignImageUrlForMeta(imageUrl)?.trim() ?? imageUrl.trim();
  const localPath = resolveLocalUploadFilePath(
    trimmed,
    CAMPAIGNS_UPLOAD_SUBDIR,
  );

  if (localPath) {
    const bytes = readFileSync(localPath).toString('base64');
    const response = await graphPostMeta<MetaAdImagesResponse>(
      `/${adAccountId}/adimages`,
      accessToken,
      { bytes },
      'media',
    );
    return extractAdImageHashFromResponse(response);
  }

  assertDirectMetaImageUrl(trimmed);

  const response = await graphPostMeta<MetaAdImagesResponse>(
    `/${adAccountId}/adimages`,
    accessToken,
    { url: trimmed },
    'media',
  );

  return extractAdImageHashFromResponse(response);
}

export async function uploadAdVideoId(
  adAccountId: string,
  accessToken: string,
  videoUrl: string,
): Promise<string> {
  const trimmed = videoUrl.trim();
  assertDirectMetaVideoUrl(trimmed);

  const response = await graphPostMeta<MetaAdVideosResponse>(
    `/${adAccountId}/advideos`,
    accessToken,
    { file_url: trimmed },
    'media',
  );

  const videoId = response.id?.trim();
  if (!videoId) {
    throw new MetaApiStepError(
      'media',
      null,
      'Meta could not download the video.',
      JSON.stringify(response),
      'Meta could not download the video. Use a direct HTTPS link to a .mp4 or .mov file.',
    );
  }

  return videoId;
}

export async function resolveCityTargetingKey(
  accessToken: string,
  country: string,
  city: string,
): Promise<string> {
  const response = await graphGetWithToken<{
    data?: Array<{ key?: string; name?: string }>;
  }>('/search', accessToken, {
    type: 'adgeolocation',
    location_types: JSON.stringify(['city']),
    q: city.trim(),
    country_code: country.toUpperCase(),
    limit: '1',
  });

  const key = response.data?.[0]?.key?.trim();
  if (!key) {
    throw new BadRequestException(
      `Could not find city "${city}" in ${country.toUpperCase()} for targeting. Check spelling or remove the city to target the whole country.`,
    );
  }

  return key;
}

async function graphPostMeta<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  step: MetaCreationStep = 'campaign',
): Promise<T & GraphErrorBody> {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  logMetaPublishStep(step, 'start', { path: normalized });
  logMetaApiRequest(step, 'POST', normalized, body);

  const url = new URL(`${FACEBOOK_GRAPH}${normalized}`);
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toMetaFormBody(body).toString(),
    signal: AbortSignal.timeout(60_000),
  });

  const raw = await res.text();
  let parsed: T & GraphErrorBody;
  try {
    parsed = JSON.parse(raw) as T & GraphErrorBody;
  } catch {
    logMetaApiResponse(step, res.status, raw);
    logMetaPublishStep(step, 'error', { reason: 'invalid_json' });
    throw new MetaApiStepError(
      step,
      null,
      'Facebook returned an unexpected response.',
      raw,
      'Facebook returned an unexpected response while creating the campaign.',
    );
  }

  logMetaApiResponse(step, res.status, parsed);

  if (!res.ok || parsed.error) {
    const rawMessage =
      parsed.error?.error_user_msg?.trim() ||
      parsed.error?.message?.trim() ||
      `Facebook API request failed (${res.status}).`;
    const message = mapMetaMarketingApiError(rawMessage, parsed.error?.code);
    logMetaPublishStep(step, 'error', {
      metaErrorCode: parsed.error?.code ?? null,
      metaErrorMessage: rawMessage,
    });
    if (parsed.error?.code === 190) {
      throw new MetaApiStepError(
        step,
        parsed.error?.code ?? null,
        rawMessage,
        raw,
        `${message} Reconnect Facebook in Settings → Integrations.`,
      );
    }
    throw new MetaApiStepError(
      step,
      parsed.error?.code ?? null,
      rawMessage,
      raw,
      message,
    );
  }

  logMetaPublishStep(step, 'success', {
    id: (parsed as { id?: string }).id ?? null,
  });

  return parsed;
}

export async function deleteMetaObject(
  objectId: string,
  accessToken: string,
): Promise<void> {
  const normalized = objectId.startsWith('/') ? objectId : `/${objectId}`;
  await graphPostMeta<{ success?: boolean }>(normalized, accessToken, {
    status: 'DELETED',
  });
}

export async function graphGetWithToken<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<T> {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${FACEBOOK_GRAPH}${normalized}`);
  url.searchParams.set('access_token', accessToken);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(25_000),
  });
  const raw = await res.text();
  const parsed = JSON.parse(raw) as T & GraphErrorBody;

  if (!res.ok || parsed.error) {
    const rawMessage =
      parsed.error?.error_user_msg?.trim() ||
      parsed.error?.message?.trim() ||
      `Facebook API request failed (${res.status}).`;
    throw new BadRequestException(
      mapMetaMarketingApiError(rawMessage, parsed.error?.code),
    );
  }

  return parsed;
}

export function stepFailureUserMessage(
  step: MetaCreationStep,
  detail: string,
): string {
  const resumeHint =
    ' After you fix this, publish again from Dealioo — we will resume from where it stopped (no duplicate campaign/ad set).';

  switch (step) {
    case 'adset':
      return `Publish incomplete — your Campaign may exist in Facebook but the Ad Set failed: ${detail}${resumeHint}`;
    case 'media':
      return (
        `Publish incomplete — Campaign and Ad Set were created in Facebook, but your ad image/video could not be uploaded: ${detail}` +
        ` That is why there is no Ad in Ads Manager yet.${resumeHint}`
      );
    case 'creative':
      return `Publish incomplete — Campaign and Ad Set exist in Facebook, but the Ad Creative failed: ${detail}${resumeHint}`;
    case 'ad':
      return `Publish incomplete — Campaign, Ad Set, and Creative exist in Facebook, but the final Ad failed: ${detail}${resumeHint}`;
    case 'campaign':
    default:
      return `Campaign creation failed: ${detail}`;
  }
}
