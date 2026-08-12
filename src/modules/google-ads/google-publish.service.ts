import { getPublicAssetsBaseUrl } from '../../utils/disk-file-upload-multer';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import type { Customer, MutateOperation, resources, services } from 'google-ads-api';
import { DataSource, Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import type { GoogleCampaignBuilderDraftData } from '../../db/entities/google-campaign-builder-draft.types';
import { GoogleCampaignDraft } from '../../db/entities/google-campaign-draft.entity';
import { User } from '../../db/entities/user.entity';
import { BusinessService } from '../business/business.service';
import { EnqueueGooglePublishResponseDto } from './dto/enqueue-google-publish-response.dto';
import { GooglePublishStatusDto } from './dto/google-publish-status.dto';
import { PublishGoogleCampaignDraftDto } from './dto/publish-google-campaign-draft.dto';
import {
  DRAFT_CONFLICT_MESSAGE,
  GOOGLE_PUBLISH_STALE_MS,
  GoogleCampaignDraftStatus,
  GoogleCampaignPublishStatus,
} from './google-campaign-draft.constants';
import { assertPublishValidation } from './google-campaign-draft-validation';
import {
  createGoogleAdsApiClient,
  createGoogleAdsCustomer,
  enums,
  formatGoogleAdsSdkError,
  normalizeGoogleCustomerId,
  ResourceNames,
} from './google-ads-sdk.client';
import { GoogleAdsTokenService } from './google-ads-token.service';
import {
  buildAdGroupPayloadFromDraft,
  buildCampaignBudgetPayloadFromDraft,
  buildCampaignPayloadFromDraft,
  buildGeoTargetPayloadsFromDraft,
  buildKeywordPayloadsFromDraft,
  buildLanguageCriterionIdsFromDraft,
  buildNegativeKeywordPayloadsFromDraft,
  buildProximityPayloadsFromDraft,
  buildResponsiveSearchAdPayloadFromDraft,
  extractGoogleResourceId,
  googleAdsCampaignConsoleUrl,
  isGoogleGeoCriterionId,
} from './google-draft-payload-builders';
import { isTransientGooglePublishError } from './google-publish-errors.util';
import {
  GOOGLE_PUBLISH_QUEUE,
  GooglePublishJobName,
  googlePublishJobId,
  googlePublishProgressPercent,
  type GooglePublishJobPayload,
  type GooglePublishStepName,
} from './google-publish-queue.constants';

type PublishContext = {
  customer: Customer;
  customerId: string;
  draftData: GoogleCampaignBuilderDraftData;
};

@Injectable()
export class GooglePublishService {
  private readonly logger = new Logger(GooglePublishService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(GoogleCampaignDraft)
    private readonly draftRepository: Repository<GoogleCampaignDraft>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly businessService: BusinessService,
    private readonly googleAdsTokenService: GoogleAdsTokenService,
    @InjectQueue(GOOGLE_PUBLISH_QUEUE)
    private readonly googlePublishQueue: Queue<GooglePublishJobPayload>,
  ) {}

  async enqueuePublish(
    user: User,
    businessId: number,
    dto: PublishGoogleCampaignDraftDto,
  ): Promise<EnqueueGooglePublishResponseDto> {
    await this.assertBusinessAccess(user, businessId);

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }
    await this.googleAdsTokenService.assertBusinessGoogleCredentials(business);

    const draftId = dto.draftId.trim();
    const jobId = googlePublishJobId(businessId, draftId);

    const result = await this.dataSource.transaction(async (manager) => {
      const draftRepo = manager.getRepository(GoogleCampaignDraft);

      const draft = await draftRepo.findOne({
        where: {
          id: draftId,
          businessId,
          userId: user.id,
        },
      });

      if (!draft) {
        throw new NotFoundException('Google campaign draft not found.');
      }

      if (
        draft.status === GoogleCampaignDraftStatus.PUBLISHED &&
        draft.googleCampaignId
      ) {
        throw new BadRequestException(
          'This draft was already published. Create a new campaign to publish again.',
        );
      }

      if (
        draft.status === GoogleCampaignDraftStatus.PUBLISHING &&
        draft.publishJobId
      ) {
        const updatedAt = draft.updatedAt?.getTime?.() ?? 0;
        const isFresh = Date.now() - updatedAt < GOOGLE_PUBLISH_STALE_MS;
        if (isFresh) {
          return {
            alreadyQueued: true as const,
            response: {
              status: 'publishing' as const,
              draftId: draft.id,
              jobId: draft.publishJobId,
              publishStatus: 'QUEUED' as const,
              publishStep: 'queued' as const,
              publishProgress: draft.publishProgress ?? 0,
              version: draft.version ?? 1,
              alreadyQueued: true,
              message:
                'Publish is already in progress for this campaign draft.',
            },
          };
        }

        draft.status = GoogleCampaignDraftStatus.FAILED;
        draft.publishStatus = GoogleCampaignPublishStatus.FAILED;
        draft.errorMessage =
          draft.errorMessage ??
          'Previous publish did not finish. Retry to continue.';
      }

      if (
        draft.status !== GoogleCampaignDraftStatus.DRAFT &&
        draft.status !== GoogleCampaignDraftStatus.FAILED
      ) {
        throw new BadRequestException(
          'This campaign cannot be published right now. It may already be publishing or published.',
        );
      }

      if (draft.version !== dto.expectedVersion) {
        throw new ConflictException({
          message: DRAFT_CONFLICT_MESSAGE,
          currentVersion: draft.version ?? dto.expectedVersion,
        });
      }

      assertPublishValidation(draft.draftData, draft.completedSteps);

      const now = new Date();
      draft.status = GoogleCampaignDraftStatus.PUBLISHING;
      draft.publishStatus = GoogleCampaignPublishStatus.QUEUED;
      draft.publishJobId = jobId;
      draft.publishStep = 'queued';
      draft.publishProgress = googlePublishProgressPercent('queued');
      draft.errorMessage = null;
      draft.updatedBy = user.id;
      draft.updatedAt = now;
      draft.version = (draft.version ?? 1) + 1;

      await draftRepo.save(draft);

      return {
        alreadyQueued: false as const,
        draft,
        response: {
          status: 'publishing' as const,
          draftId: draft.id,
          jobId,
          publishStatus: 'QUEUED' as const,
          publishStep: 'queued' as const,
          publishProgress: googlePublishProgressPercent('queued'),
          version: draft.version ?? 1,
          alreadyQueued: false,
          message:
            'Campaign publish accepted and queued. Track progress via publish status.',
        },
      };
    });

    if (result.alreadyQueued) {
      return result.response;
    }

    const { draft, response } = result;

    const prior = await this.googlePublishQueue.getJob(jobId);
    if (prior) {
      const state = await prior.getState();
      if (state === 'completed' || state === 'failed') {
        await prior.remove();
      } else if (
        state === 'waiting' ||
        state === 'active' ||
        state === 'delayed' ||
        state === 'prioritized'
      ) {
        return {
          status: 'publishing',
          draftId: draft.id,
          jobId,
          publishStatus: 'QUEUED',
          publishStep: 'queued',
          publishProgress: draft.publishProgress ?? 0,
          version: draft.version ?? 1,
          alreadyQueued: true,
          message: 'Publish is already in progress for this campaign draft.',
        };
      }
    }

    await this.googlePublishQueue.add(
      GooglePublishJobName.PUBLISH_DRAFT,
      {
        userId: user.id,
        businessId,
        draftId: draft.id,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(
      `Enqueued google publish job=${jobId} draft=${draft.id} business=${businessId}`,
    );

    return response;
  }

  async getPublishStatus(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<GooglePublishStatusDto> {
    await this.assertBusinessAccess(user, businessId);

    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        businessId,
        userId: user.id,
      },
    });

    if (!draft) {
      throw new NotFoundException('Google campaign draft not found.');
    }

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    const customerId = business?.googleCustomerId?.trim() ?? '';

    return {
      draftId: draft.id,
      status: draft.status,
      publishStatus: draft.publishStatus,
      publishStep: draft.publishStep,
      publishProgress: draft.publishProgress ?? 0,
      jobId: draft.publishJobId,
      googleBudgetId: draft.googleBudgetId,
      googleCampaignId: draft.googleCampaignId,
      googleAdGroupId: draft.googleAdGroupId,
      googleAdId: draft.googleAdId,
      googleKeywordIds: draft.googleKeywordIds ?? [],
      errorMessage: draft.errorMessage,
      publishedAt: draft.publishedAt,
      adsConsoleUrl:
        draft.googleCampaignId && customerId
          ? googleAdsCampaignConsoleUrl(customerId, draft.googleCampaignId)
          : null,
      version: draft.version ?? 1,
    };
  }

  async processQueuedPublish(
    job: Job<GooglePublishJobPayload>,
  ): Promise<void> {
    const { userId, businessId, draftId } = job.data;
    const jobId = String(job.id ?? googlePublishJobId(businessId, draftId));

    const draft = await this.draftRepository.findOne({
      where: { id: draftId, businessId, userId },
    });
    if (!draft) {
      throw new UnrecoverableError(`Draft ${draftId} not found.`);
    }

    if (
      draft.status === GoogleCampaignDraftStatus.PUBLISHED &&
      draft.googleCampaignId
    ) {
      this.logger.log(`Draft ${draftId} already published; skipping job.`);
      return;
    }

    draft.status = GoogleCampaignDraftStatus.PUBLISHING;
    draft.publishStatus = GoogleCampaignPublishStatus.PUBLISHING;
    draft.publishJobId = jobId;
    draft.publishStep = 'preparing';
    draft.publishProgress = googlePublishProgressPercent('preparing');
    draft.errorMessage = null;
    await this.draftRepository.save(draft);

    try {
      await this.runPublishPipeline(userId, businessId, draft, jobId);
    } catch (err) {
      await this.markPublishFailed(draft, err);

      if (!isTransientGooglePublishError(err)) {
        throw new UnrecoverableError(this.publishErrorMessage(err));
      }
      throw err;
    }
  }

  private async runPublishPipeline(
    userId: number,
    businessId: number,
    draft: GoogleCampaignDraft,
    jobId: string,
  ): Promise<void> {
    await this.beginStep(draft, 'preparing');
    this.logger.log(
      `Google publish pipeline start draft=${draft.id} (creates run one Google Ads API call at a time)`,
    );
    assertPublishValidation(draft.draftData, draft.completedSteps);

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new UnrecoverableError(`Business ${businessId} not found.`);
    }

    const credentials =
      await this.googleAdsTokenService.assertBusinessGoogleCredentials(business);

    const customerId = normalizeGoogleCustomerId(credentials.customerId ?? '');
    const loginCustomerId = normalizeGoogleCustomerId(
      credentials.loginCustomerId || customerId,
    );
    if (!customerId) {
      throw new BadRequestException(
        'No Google Ads account selected. Reconnect Google Ads in Settings → Integrations and choose a customer account.',
      );
    }

    const client = createGoogleAdsApiClient({
      clientId: this.googleAdsTokenService.getClientId(),
      clientSecret: this.googleAdsTokenService.getClientSecret(),
      developerToken: this.googleAdsTokenService.getDeveloperToken(),
    });
    const customer = createGoogleAdsCustomer(client, {
      customerId,
      refreshToken: credentials.refreshToken,
      loginCustomerId,
    });

    const draftData = draft.draftData!;
    const ctx: PublishContext = { customer, customerId, draftData };

    await this.completeStep(draft, 'preparing');

    let budgetId = draft.googleBudgetId;
    let campaignId = draft.googleCampaignId;
    let adGroupId = draft.googleAdGroupId;
    let adId = draft.googleAdId;
    let keywordIds = [...(draft.googleKeywordIds ?? [])];

    if (!budgetId) {
      await this.beginStep(draft, 'budget');
      budgetId = await this.createCampaignBudget(ctx);
      draft.googleBudgetId = budgetId;
      await this.draftRepository.save(draft);
      await this.completeStep(draft, 'budget');
    }

    if (!campaignId) {
      await this.beginStep(draft, 'campaign');
      campaignId = await this.createCampaign(ctx, budgetId!);
      draft.googleCampaignId = campaignId;
      await this.draftRepository.save(draft);
    }

    if (!adGroupId) {
      await this.beginStep(draft, 'campaign');
      await this.createCampaignCriteria(ctx, campaignId!);
      await this.completeStep(draft, 'campaign');
    }

    if (!adGroupId) {
      await this.beginStep(draft, 'ad_group');
      adGroupId = await this.createAdGroup(ctx, campaignId!);
      draft.googleAdGroupId = adGroupId;
      await this.draftRepository.save(draft);
      await this.completeStep(draft, 'ad_group');
    }

    if (keywordIds.length === 0) {
      await this.beginStep(draft, 'keywords');
      keywordIds = await this.createKeywords(ctx, adGroupId!);
      draft.googleKeywordIds = keywordIds;
      await this.draftRepository.save(draft);
      await this.completeStep(draft, 'keywords');
    }

    if (!adId) {
      await this.beginStep(draft, 'ads');
      adId = await this.createResponsiveSearchAd(ctx, adGroupId!);
      draft.googleAdId = adId;
      await this.draftRepository.save(draft);
      await this.uploadBusinessBrandingAssets(ctx, campaignId!);
      await this.completeStep(draft, 'ads');
    }

    const publishedAt = new Date();
    draft.status = GoogleCampaignDraftStatus.PUBLISHED;
    draft.publishStatus = GoogleCampaignPublishStatus.PUBLISHED;
    draft.publishStep = 'done';
    draft.publishProgress = 100;
    draft.publishedAt = publishedAt;
    draft.errorMessage = null;
    draft.googleBudgetId = budgetId;
    draft.googleCampaignId = campaignId;
    draft.googleAdGroupId = adGroupId;
    draft.googleAdId = adId;
    draft.googleKeywordIds = keywordIds;
    await this.draftRepository.save(draft);

    this.logger.log(
      `Google publish done: draft=${draft.id} business=${businessId} job=${jobId} user=${userId} campaign=${campaignId} adGroup=${adGroupId} ad=${adId}`,
    );
  }

  private async createCampaignBudget(ctx: PublishContext): Promise<string> {
    const payload = buildCampaignBudgetPayloadFromDraft(ctx.draftData);
    const response = await this.mutateOne(ctx, 'budget', 'campaign_budget', {
      entity: 'campaign_budget',
      operation: 'create',
      resource: {
        name: payload.name,
        amount_micros: payload.amountMicros,
        delivery_method: payload.deliveryMethod,
        explicitly_shared: payload.explicitlyShared,
      },
    });
    const id = extractGoogleResourceId(this.firstResourceName(response));
    if (!id) {
      throw new BadRequestException(
        '[budget] Google Ads did not return a budget id.',
      );
    }
    return id;
  }

  private async createCampaign(
    ctx: PublishContext,
    budgetId: string,
  ): Promise<string> {
    const payload = buildCampaignPayloadFromDraft(ctx.draftData);
    const resource: resources.ICampaign & {
      start_date?: string;
      end_date?: string;
      contains_eu_political_advertising?: number;
    } = {
      name: payload.name,
      status: payload.status,
      advertising_channel_type: payload.advertisingChannelType,
      campaign_budget: ResourceNames.campaignBudget(ctx.customerId, budgetId),
      contains_eu_political_advertising:
        enums.EuPoliticalAdvertisingStatus
          .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
      network_settings: {
        target_google_search: payload.networkSettings.targetGoogleSearch,
        target_search_network: payload.networkSettings.targetSearchNetwork,
        target_content_network: payload.networkSettings.targetContentNetwork,
      },
      ...payload.bidding,
    };
    if (payload.startDate) resource.start_date = payload.startDate;
    if (payload.endDate) resource.end_date = payload.endDate;

    this.logger.log(
      `Google campaign bidding payload draft=${JSON.stringify(payload.bidding)}`,
    );

    const response = await this.mutateOne(ctx, 'campaign', 'campaign', {
      entity: 'campaign',
      operation: 'create',
      resource,
    });
    const id = extractGoogleResourceId(this.firstResourceName(response));
    if (!id) {
      throw new BadRequestException(
        '[campaign] Google Ads did not return a campaign id.',
      );
    }
    return id;
  }

  private async createCampaignCriteria(
    ctx: PublishContext,
    campaignId: string,
  ): Promise<void> {
    const campaignResource = ResourceNames.campaign(ctx.customerId, campaignId);

    const proximities = buildProximityPayloadsFromDraft(ctx.draftData);
    const pinTargets = (ctx.draftData.targetLocations ?? []).filter(
      (row) => row.type !== 'country',
    );
    const missingTargetRadius = pinTargets.some(
      (pin) =>
        !proximities.some(
          (row) =>
            !row.negative &&
            row.centerLocationId &&
            row.centerLocationId === pin.id?.trim(),
        ),
    );
    if (pinTargets.length > 0 && (proximities.length === 0 || missingTargetRadius)) {
      throw new BadRequestException(
        '[campaign/proximity] Each city/region needs its own map radius. Go back to Locations, click each place, set its radius, then publish again.',
      );
    }

    for (const proximity of proximities) {
      const unitLabel = proximity.radiusUnit === 'MILES' ? 'mi' : 'km';
      const label = `${proximity.negative ? 'proximity_exclude' : 'proximity'}:${proximity.latitude.toFixed(5)},${proximity.longitude.toFixed(5)}:${proximity.radiusValue}${unitLabel}`;
      this.logger.log(
        `Creating Google proximity criterion ${label} address=${proximity.addressLabel ?? ''}`,
      );
      try {
        if (proximity.negative === true) {
          this.logger.warn(
            `Skipping unsupported negative proximity op=${label}; excludes use location criteria instead`,
          );
          continue;
        }
        await this.mutateOne(ctx, 'campaign', label, {
          entity: 'campaign_criterion',
          operation: 'create',
          resource: {
            campaign: campaignResource,
            negative: false,
            proximity: {
              geo_point: {
                latitude_in_micro_degrees: Math.round(
                  proximity.latitude * 1_000_000,
                ),
                longitude_in_micro_degrees: Math.round(
                  proximity.longitude * 1_000_000,
                ),
              },
              radius: proximity.radiusValue,
              radius_units:
                proximity.radiusUnit === 'MILES'
                  ? enums.ProximityRadiusUnits.MILES
                  : enums.ProximityRadiusUnits.KILOMETERS,
            },
          },
        });
      } catch (err) {
        if (!this.isAlreadyExistsGoogleError(err)) {
          throw err;
        }
        this.logger.log(
          `Google proximity already present, skipping op=${label}`,
        );
      }
    }

    for (const geo of buildGeoTargetPayloadsFromDraft(ctx.draftData)) {
      const criterionId = await this.resolveGoogleGeoCriterionId(ctx, geo);
      const label = geo.negative
        ? `location_exclude:${criterionId}`
        : `location:${criterionId}`;
      try {
        await this.mutateOne(ctx, 'campaign', label, {
          entity: 'campaign_criterion',
          operation: 'create',
          resource: {
            campaign: campaignResource,
            negative: geo.negative,
            location: {
              geo_target_constant: ResourceNames.geoTargetConstant(criterionId),
            },
          },
        });
      } catch (err) {
        if (this.isAlreadyExistsGoogleError(err)) {
          this.logger.log(
            `Google location already present, skipping op=${label}`,
          );
          continue;
        }
        throw err;
      }
    }

    for (const languageId of buildLanguageCriterionIdsFromDraft(ctx.draftData)) {
      const label = `language:${languageId}`;
      try {
        await this.mutateOne(ctx, 'campaign', label, {
          entity: 'campaign_criterion',
          operation: 'create',
          resource: {
            campaign: campaignResource,
            language: {
              language_constant: ResourceNames.languageConstant(languageId),
            },
          },
        });
      } catch (err) {
        if (this.isAlreadyExistsGoogleError(err)) {
          this.logger.log(
            `Google language already present, skipping op=${label}`,
          );
          continue;
        }
        throw err;
      }
    }
  }

  private async resolveGoogleGeoCriterionId(
    ctx: PublishContext,
    geo: {
      rawId: string;
      name: string;
      type: 'country' | 'state' | 'city' | 'postal_code';
    },
  ): Promise<string> {
    if (isGoogleGeoCriterionId(geo.rawId)) {
      return geo.rawId.trim();
    }

    this.logger.log(
      `Resolving Google geo target for name="${geo.name}" rawId=${geo.rawId} type=${geo.type}`,
    );

    let response;
    try {
      response = await ctx.customer.geoTargetConstants.suggestGeoTargetConstants({
        locale: 'en',
        location_names: { names: [geo.name] },
      } as services.SuggestGeoTargetConstantsRequest);
    } catch (err) {
      throw new BadRequestException(
        `[campaign/location:${geo.rawId}] Could not look up Google location for "${geo.name}". ${formatGoogleAdsSdkError(err, 'Geo suggest failed.')}`,
      );
    }

    const suggestions = response.geo_target_constant_suggestions ?? [];
    if (suggestions.length === 0) {
      throw new BadRequestException(
        `[campaign/location:${geo.rawId}] Google Ads has no location match for "${geo.name}". Pick a country/city from the list again.`,
      );
    }

    const preferredTypes = this.googleTargetTypesForLocationType(geo.type);
    const ranked = [...suggestions].sort((a, b) => {
      const aType = a.geo_target_constant?.target_type ?? '';
      const bType = b.geo_target_constant?.target_type ?? '';
      const aScore = preferredTypes.includes(aType) ? 0 : 1;
      const bScore = preferredTypes.includes(bType) ? 0 : 1;
      if (aScore !== bScore) return aScore - bScore;
      return Number(b.reach ?? 0) - Number(a.reach ?? 0);
    });

    const best = ranked[0]?.geo_target_constant;
    const criterionId =
      extractGoogleResourceId(best?.resource_name) ||
      (best?.id != null ? String(best.id) : null);

    if (!criterionId || !isGoogleGeoCriterionId(criterionId)) {
      throw new BadRequestException(
        `[campaign/location:${geo.rawId}] Google returned an invalid location id for "${geo.name}".`,
      );
    }

    this.logger.log(
      `Resolved location "${geo.name}" → geoTargetConstants/${criterionId} (${best?.target_type ?? 'unknown'})`,
    );
    return criterionId;
  }

  private googleTargetTypesForLocationType(
    type: 'country' | 'state' | 'city' | 'postal_code',
  ): string[] {
    switch (type) {
      case 'country':
        return ['Country'];
      case 'state':
        return ['State', 'Province', 'Region', 'Territory', 'Department'];
      case 'city':
        return ['City', 'Municipality', 'Neighborhood', 'Borough', 'County'];
      case 'postal_code':
        return ['Postal Code', 'Postal Code Prefix'];
      default:
        return [];
    }
  }

  private isAlreadyExistsGoogleError(err: unknown): boolean {
    const message = this.publishErrorMessage(err).toLowerCase();
    return (
      message.includes('already exists') ||
      message.includes('duplicate') ||
      message.includes('already present')
    );
  }

  private async createAdGroup(
    ctx: PublishContext,
    campaignId: string,
  ): Promise<string> {
    const payload = buildAdGroupPayloadFromDraft(ctx.draftData);
    const response = await this.mutateOne(ctx, 'ad_group', 'ad_group', {
      entity: 'ad_group',
      operation: 'create',
      resource: {
        name: payload.name,
        status: payload.status,
        type: payload.type,
        campaign: ResourceNames.campaign(ctx.customerId, campaignId),
      },
    });
    const id = extractGoogleResourceId(this.firstResourceName(response));
    if (!id) {
      throw new BadRequestException(
        '[ad_group] Google Ads did not return an ad group id.',
      );
    }
    return id;
  }

  private async createKeywords(
    ctx: PublishContext,
    adGroupId: string,
  ): Promise<string[]> {
    const adGroupResource = ResourceNames.adGroup(ctx.customerId, adGroupId);
    const positives = buildKeywordPayloadsFromDraft(ctx.draftData);
    const negatives = buildNegativeKeywordPayloadsFromDraft(ctx.draftData);
    const ids: string[] = [];

    for (const keyword of positives) {
      const response = await this.mutateOne(
        ctx,
        'keywords',
        `keyword:${keyword.text}`,
        {
          entity: 'ad_group_criterion',
          operation: 'create',
          resource: {
            ad_group: adGroupResource,
            status: enums.AdGroupCriterionStatus.ENABLED,
            keyword: {
              text: keyword.text,
              match_type: keyword.matchType,
            },
          },
        },
      );
      const id = extractGoogleResourceId(
        response.mutate_operation_responses?.[0]?.ad_group_criterion_result
          ?.resource_name,
      );
      if (id) ids.push(id);
    }

    for (const keyword of negatives) {
      const response = await this.mutateOne(
        ctx,
        'keywords',
        `negative_keyword:${keyword.text}`,
        {
          entity: 'ad_group_criterion',
          operation: 'create',
          resource: {
            ad_group: adGroupResource,
            negative: true,
            keyword: {
              text: keyword.text,
              match_type: keyword.matchType,
            },
          },
        },
      );
      const id = extractGoogleResourceId(
        response.mutate_operation_responses?.[0]?.ad_group_criterion_result
          ?.resource_name,
      );
      if (id) ids.push(id);
    }

    if (ids.length === 0) {
      throw new BadRequestException(
        '[keywords] Google Ads did not return keyword criterion ids.',
      );
    }

    return ids;
  }

  private async createResponsiveSearchAd(
    ctx: PublishContext,
    adGroupId: string,
  ): Promise<string> {
    const payload = buildResponsiveSearchAdPayloadFromDraft(ctx.draftData);
    const response = await this.mutateOne(ctx, 'ads', 'responsive_search_ad', {
      entity: 'ad_group_ad',
      operation: 'create',
      resource: {
        ad_group: ResourceNames.adGroup(ctx.customerId, adGroupId),
        status: enums.AdGroupAdStatus.PAUSED,
        ad: {
          final_urls: payload.finalUrls,
          responsive_search_ad: {
            headlines: payload.headlines,
            descriptions: payload.descriptions,
            path1: payload.path1,
            path2: payload.path2,
          },
        },
      },
    });

    const resourceName = this.firstResourceName(response);
    const id =
      extractGoogleResourceId(resourceName)?.split('~').pop() ??
      extractGoogleResourceId(resourceName);
    if (!id) {
      throw new BadRequestException(
        '[ads] Google Ads did not return an ad id.',
      );
    }
    return id;
  }

  private async uploadBusinessBrandingAssets(
    ctx: PublishContext,
    campaignId: string,
  ): Promise<void> {
    const campaignResource = ResourceNames.campaign(ctx.customerId, campaignId);
    const businessName = (
      ctx.draftData.extensionBusinessName ||
      ctx.draftData.businessName ||
      ''
    ).trim();
    const logoUrl = (ctx.draftData.logoPreviewUrl || '').trim();

    if (businessName) {
      try {
        await this.createAndLinkBusinessNameAsset(
          ctx,
          campaignResource,
          businessName,
        );
      } catch (err) {
        this.logger.warn(
          `Business name asset upload skipped: ${this.publishErrorMessage(err)}`,
        );
      }
    }

    if (logoUrl && !logoUrl.startsWith('blob:')) {
      try {
        await this.createAndLinkLogoAsset(
          ctx,
          campaignResource,
          logoUrl,
          ctx.draftData.logoFileName?.trim() || 'Business logo',
        );
      } catch (err) {
        this.logger.warn(
          `Logo asset upload skipped: ${this.publishErrorMessage(err)}`,
        );
      }
    }
  }

  private async createAndLinkBusinessNameAsset(
    ctx: PublishContext,
    campaignResource: string,
    businessName: string,
  ): Promise<void> {
    const textResponse = await this.mutateOne(ctx, 'ads', 'business_name_asset', {
      entity: 'asset',
      operation: 'create',
      resource: {
        name: `Business name · ${businessName}`.slice(0, 100),
        type: enums.AssetType.TEXT,
        text_asset: { text: businessName.slice(0, 100) },
      },
    });
    const textAssetName = this.firstResourceName(textResponse);
    if (!textAssetName) {
      throw new BadRequestException(
        '[ads/business_name] Google Ads did not return a text asset id.',
      );
    }

    try {
      await this.mutateOne(ctx, 'ads', 'business_name_link', {
        entity: 'campaign_asset',
        operation: 'create',
        resource: {
          campaign: campaignResource,
          asset: textAssetName,
          field_type: enums.AssetFieldType.BUSINESS_NAME,
        },
      });
      return;
    } catch (err) {
      if (!this.isAlreadyExistsGoogleError(err)) {
        this.logger.log(
          `BUSINESS_NAME link not available for this campaign; adding Search callout instead. ${this.publishErrorMessage(err)}`,
        );
      } else {
        return;
      }
    }

    const calloutText = businessName.slice(0, 25);
    const calloutResponse = await this.mutateOne(
      ctx,
      'ads',
      'business_name_callout_asset',
      {
        entity: 'asset',
        operation: 'create',
        resource: {
          name: `Callout · ${calloutText}`.slice(0, 100),
          type: enums.AssetType.CALLOUT,
          callout_asset: { callout_text: calloutText },
        },
      },
    );
    const calloutAssetName = this.firstResourceName(calloutResponse);
    if (!calloutAssetName) {
      throw new BadRequestException(
        '[ads/business_name] Google Ads did not return a callout asset id.',
      );
    }
    try {
      await this.mutateOne(ctx, 'ads', 'business_name_callout_link', {
        entity: 'campaign_asset',
        operation: 'create',
        resource: {
          campaign: campaignResource,
          asset: calloutAssetName,
          field_type: enums.AssetFieldType.CALLOUT,
        },
      });
    } catch (err) {
      if (!this.isAlreadyExistsGoogleError(err)) throw err;
    }
  }

  private async createAndLinkLogoAsset(
    ctx: PublishContext,
    campaignResource: string,
    logoUrl: string,
    logoFileName: string,
  ): Promise<void> {
    const imageBytes = await this.loadLogoImageBytes(logoUrl);
    const imageResponse = await this.mutateOne(ctx, 'ads', 'logo_image_asset', {
      entity: 'asset',
      operation: 'create',
      resource: {
        name: `Logo · ${logoFileName}`.slice(0, 100),
        type: enums.AssetType.IMAGE,
        image_asset: { data: imageBytes.toString('base64') },
      },
    });
    const imageAssetName = this.firstResourceName(imageResponse);
    if (!imageAssetName) {
      throw new BadRequestException(
        '[ads/logo] Google Ads did not return an image asset id.',
      );
    }

    const fieldTypes = [
      enums.AssetFieldType.LOGO,
      enums.AssetFieldType.BUSINESS_LOGO,
      enums.AssetFieldType.AD_IMAGE,
    ] as const;

    let linked = false;
    let lastError: unknown = null;
    for (const fieldType of fieldTypes) {
      try {
        await this.mutateOne(ctx, 'ads', `logo_link:${fieldType}`, {
          entity: 'campaign_asset',
          operation: 'create',
          resource: {
            campaign: campaignResource,
            asset: imageAssetName,
            field_type: fieldType,
          },
        });
        linked = true;
        break;
      } catch (err) {
        if (this.isAlreadyExistsGoogleError(err)) {
          linked = true;
          break;
        }
        lastError = err;
        this.logger.log(
          `Logo field_type=${fieldType} link failed; trying next. ${this.publishErrorMessage(err)}`,
        );
      }
    }

    if (!linked && lastError) {
      throw lastError;
    }
  }

  private async loadLogoImageBytes(logoUrl: string): Promise<Buffer> {
    const trimmed = logoUrl.trim();
    if (trimmed.startsWith('data:')) {
      const match = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
      if (!match?.[1]) {
        throw new BadRequestException(
          '[ads/logo] Logo data URL is invalid. Re-upload the logo and try again.',
        );
      }
      return Buffer.from(match[1], 'base64');
    }

    let absoluteUrl = trimmed;
    if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
      const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      absoluteUrl = `${getPublicAssetsBaseUrl()}${path}`;
    }

    if (!/^https?:\/\//i.test(absoluteUrl)) {
      throw new BadRequestException(
        '[ads/logo] Logo URL must be a public http(s) or uploaded image. Re-upload the logo and try again.',
      );
    }

    const response = await fetch(absoluteUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new BadRequestException(
        `[ads/logo] Could not download logo image (${response.status}). Re-upload the logo and try again.`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new BadRequestException(
        '[ads/logo] Logo image was empty. Re-upload the logo and try again.',
      );
    }
    return buffer;
  }

  private async mutateOne<T>(
    ctx: PublishContext,
    step: GooglePublishStepName,
    operationLabel: string,
    operation: MutateOperation<T>,
  ): Promise<services.MutateGoogleAdsResponse> {
    this.logger.log(
      `Google Ads API → step=${step} op=${operationLabel} entity=${operation.entity}`,
    );
    try {
      const response = await ctx.customer.mutateResources([operation]);
      this.logger.log(
        `Google Ads API ✓ step=${step} op=${operationLabel} entity=${operation.entity}`,
      );
      return response;
    } catch (err) {
      const googleMessage = formatGoogleAdsSdkError(
        err,
        'Google Ads API request failed. Reconnect Google Ads in Settings → Integrations.',
      );
      throw new BadRequestException(
        `[${step}/${operationLabel}] ${googleMessage}`,
      );
    }
  }

  private firstResourceName(
    response: services.MutateGoogleAdsResponse,
  ): string | null {
    for (const row of response.mutate_operation_responses ?? []) {
      const name =
        row.campaign_budget_result?.resource_name ||
        row.campaign_result?.resource_name ||
        row.ad_group_result?.resource_name ||
        row.ad_group_ad_result?.resource_name ||
        row.ad_group_criterion_result?.resource_name ||
        row.campaign_criterion_result?.resource_name ||
        row.asset_result?.resource_name ||
        row.campaign_asset_result?.resource_name ||
        null;
      if (name) return name;
    }
    return null;
  }

  private async beginStep(
    draft: GoogleCampaignDraft,
    step: GooglePublishStepName,
  ): Promise<void> {
    draft.publishStatus = GoogleCampaignPublishStatus.PUBLISHING;
    draft.publishStep = step;
    draft.publishProgress = googlePublishProgressPercent(step);
    await this.draftRepository.save(draft);
  }

  private async completeStep(
    draft: GoogleCampaignDraft,
    step: GooglePublishStepName,
  ): Promise<void> {
    draft.publishStep = step;
    draft.publishProgress = googlePublishProgressPercent(step);
    await this.draftRepository.save(draft);
  }

  private async markPublishFailed(
    draft: GoogleCampaignDraft,
    err: unknown,
  ): Promise<void> {
    const step = draft.publishStep ?? 'preparing';
    const message = this.publishErrorMessage(err);
    const withStep = message.startsWith('[')
      ? message
      : `[${step}] ${message}`;
    draft.status = GoogleCampaignDraftStatus.FAILED;
    draft.publishStatus = GoogleCampaignPublishStatus.FAILED;
    draft.errorMessage = withStep;
    draft.publishStep = step;
    await this.draftRepository.save(draft);
    this.logger.error(
      `Google publish failed for draft=${draft.id} at step=${step}: ${withStep}`,
    );
  }

  private publishErrorMessage(err: unknown): string {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (typeof response === 'string' && response.trim()) {
        return response;
      }
      if (typeof response === 'object' && response && 'message' in response) {
        const message = (response as { message?: string | string[] }).message;
        if (Array.isArray(message)) return message.join(' ');
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
    if (err instanceof Error && err.message.trim()) {
      return err.message;
    }
    return String(err ?? 'Google publish failed.');
  }

  private async assertBusinessAccess(
    user: User,
    businessId: number,
  ): Promise<void> {
    const business = await this.businessService.findBusinessForUser(
      user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }
  }
}
