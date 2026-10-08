import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  metaCampaignPermissionKeysFor,
  type MetaCampaignAccessAction,
} from '../member/member.constants';
import { assertBusinessCanManageMetaAds } from '../facebook/facebook-oauth-scopes.util';
import { FacebookMetaTokenService } from '../facebook/facebook-meta-token.service';
import { normalizeCampaignImageUrlForMeta } from '../../utils/disk-file-upload-multer';
import {
  graphGetWithToken,
  normalizeAdAccountId,
} from './facebook-campaign-meta';
import { AdCreativeStepDataDto } from './dto/ad-creative-step-data.dto';
import { AdSetStepDataDto } from './dto/adset-step-data.dto';
import { AutosaveDraftDto } from './dto/autosave-draft.dto';
import {
  CampaignStepDataDto,
  MetaCampaignDraftResponseDto,
} from './dto/meta-campaign-draft-response.dto';
import { SaveAdCreativeStepDto } from './dto/save-ad-creative-step.dto';
import { SaveAdSetStepDto } from './dto/save-adset-step.dto';
import { SaveCampaignStepDto, MetaBudgetStrategy } from './dto/save-campaign-step.dto';
import {
  MetaAdSetBudgetType,
  MetaBidStrategy,
  MetaCampaignObjective,
  MetaCampaignStatus,
  MetaCreativeFormat,
  MetaGender,
} from './meta-campaign.constants';
import {
  assertAtLeastOnePlacement,
  assertAudienceCityRadius,
  assertOptimizationGoalForObjective,
  assertScheduleOrder,
  budgetToMetaMinorUnits,
  combineDateAndTime,
} from './meta-adset-draft-validation';
import { normalizeDraftPromotedObject } from './meta-publish-preflight';
import {
  assertAdCreativeMedia,
  assertAdCreativeDestinationUrl,
  buildDestinationUrlWithParams,
  parseCampaignIdFromDestinationUrl,
} from './meta-ad-creative-draft-validation';

@Injectable()
export class MetaCampaignDraftService {
  private readonly logger = new Logger(MetaCampaignDraftService.name);

  constructor(
    @InjectRepository(MetaCampaignDraft)
    private readonly draftRepository: Repository<MetaCampaignDraft>,
    @InjectRepository(FacebookCampaign)
    private readonly facebookCampaignRepository: Repository<FacebookCampaign>,
    private readonly businessAccessService: BusinessAccessService,
    private readonly metaTokenService: FacebookMetaTokenService,
  ) {}

  async saveCampaignStep(
    user: User,
    businessId: number,
    dto: SaveCampaignStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {
    await this.loadOwnedBusiness(user, businessId, 'create');
    this.assertCampaignStepBusinessRules(dto);

    const campaignData: CampaignStepDataDto = {
      name: dto.name.trim(),
      buyingType: dto.buyingType,
      objective: dto.objective,
      specialAdCategories: dto.specialAdCategories,
      budgetStrategy: dto.budgetStrategy,
      campaignBudgetOptimization:
        dto.budgetStrategy === MetaBudgetStrategy.CAMPAIGN,
      campaignBudgetType: dto.campaignBudgetType,
      campaignDailyBudget: dto.campaignDailyBudget,
      campaignLifetimeBudget: dto.campaignLifetimeBudget,
      campaignBidStrategy: dto.campaignBidStrategy,
      budgetScheduling: dto.budgetScheduling ?? 'none',
      campaignSpendLimit: dto.campaignSpendLimit,
      status: dto.status,
    };

    const now = new Date();

    if (dto.draftId?.trim()) {
      const existing = await this.findEditableDraft(
        user.id,
        businessId,
        dto.draftId.trim(),
      );

      existing.campaignData = campaignData;
      existing.currentStep = Math.max(existing.currentStep, 2);
      existing.completedSteps = this.mergeCompletedSteps(
        existing.completedSteps,
        [1],
      );
      existing.lastSavedAt = now;
      existing.version = (existing.version ?? 1) + 1;
      const saved = await this.draftRepository.save(existing);
      return this.toResponse(saved);
    }

    const created = await this.draftRepository.save({
      userId: user.id,
      businessId,
      currentStep: 2,
      status: 'draft',
      campaignData,
      adSetData: null,
      adCreativeData: null,
      errorMessage: null,
      version: 1,
      completedSteps: [1],
      lastSavedAt: now,
      publishStatus: null,
      publishJobId: null,
      publishStep: null,
      publishProgress: 0,
      publishedAt: null,
    });

    return this.toResponse(created);
  }

  async saveAdSetStep(
    user: User,
    businessId: number,
    dto: SaveAdSetStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {
    await this.loadOwnedBusiness(user, businessId, 'create');

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      dto.draftId.trim(),
    );

    if (!draft.campaignData) {
      throw new NotFoundException(
        'Campaign draft not found. Complete Step 1 (Campaign) first.',
      );
    }

    const campaignData = draft.campaignData as CampaignStepDataDto;
    this.assertAdSetStepBusinessRules(dto, campaignData);

    const startDateTime = combineDateAndTime(
      dto.startDate,
      dto.startTime,
      dto.timezone,
    );
    const hasEndDate = Boolean(dto.endDate?.trim() && dto.endTime?.trim());
    const endDateTime = hasEndDate
      ? combineDateAndTime(dto.endDate!, dto.endTime!, dto.timezone)
      : undefined;
    assertScheduleOrder(startDateTime, endDateTime);

    const cboEnabled = campaignData.campaignBudgetOptimization;
    const usesLifetimeBudget =
      (!cboEnabled && dto.budgetType === MetaAdSetBudgetType.LIFETIME) ||
      (cboEnabled && campaignData.campaignBudgetType === 'lifetime');
    if (usesLifetimeBudget && !hasEndDate) {
      throw new BadRequestException(
        'Lifetime budgets require an end date. Turn on “Set an end date” or switch to a daily budget.',
      );
    }

    let dailyBudgetMinor: string | undefined;
    let lifetimeBudgetMinor: string | undefined;

    if (!cboEnabled) {
      if (dto.budgetType === MetaAdSetBudgetType.DAILY && dto.dailyBudget) {
        dailyBudgetMinor = budgetToMetaMinorUnits(dto.dailyBudget);
      }
      if (
        dto.budgetType === MetaAdSetBudgetType.LIFETIME &&
        dto.lifetimeBudget
      ) {
        lifetimeBudgetMinor = budgetToMetaMinorUnits(dto.lifetimeBudget);
      }
    }

    const adSetData: AdSetStepDataDto = {
      name: dto.name.trim(),
      draftId: dto.draftId.trim(),
      status: dto.status,
      budgetType: dto.budgetType,
      dailyBudget: dto.dailyBudget,
      lifetimeBudget: dto.lifetimeBudget,
      dailyBudgetMinor,
      lifetimeBudgetMinor,
      bidStrategy: dto.bidStrategy,
      bidAmount: dto.bidAmount,
      billingEvent: dto.billingEvent,
      startDate: dto.startDate,
      startTime: dto.startTime,
      endDate: hasEndDate ? dto.endDate : undefined,
      endTime: hasEndDate ? dto.endTime : undefined,
      timezone: dto.timezone,
      startDateTime,
      endDateTime,
      optimizationGoal: dto.optimizationGoal,
      destinationType: dto.destinationType,
      promotedObject: normalizeDraftPromotedObject(
        dto.optimizationGoal,
        dto.promotedObject,
        campaignData.objective,
      ),
      audience: {
        country: dto.audience.country.toUpperCase(),
        region: dto.audience.region?.trim() || undefined,
        city: dto.audience.city?.trim() || undefined,
        radius: dto.audience.radius,
        distanceUnit: dto.audience.distanceUnit,
        latitude: dto.audience.latitude,
        longitude: dto.audience.longitude,
        locations: dto.audience.locations,
        ageMin: dto.audience.ageMin,
        ageMax: dto.audience.ageMax,
        gender: dto.audience.gender,
        languages: dto.audience.languages,
        interests: dto.audience.interests,
        behaviors: dto.audience.behaviors,
        demographics: dto.audience.demographics,
        customAudiences: dto.audience.customAudiences,
        excludedCustomAudiences: dto.audience.excludedCustomAudiences,
      },
      placements: dto.placements,
    };

    draft.adSetData = adSetData;
    draft.currentStep = Math.max(draft.currentStep, 3);
    draft.completedSteps = this.mergeCompletedSteps(draft.completedSteps, [
      1, 2,
    ]);
    draft.lastSavedAt = new Date();
    draft.version = (draft.version ?? 1) + 1;
    const saved = await this.draftRepository.save(draft);
    return this.toResponse(saved);
  }

  async saveAdCreativeStep(
    user: User,
    businessId: number,
    dto: SaveAdCreativeStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {
    await this.loadOwnedBusiness(user, businessId, 'create');

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      dto.draftId.trim(),
    );

    if (!draft.campaignData || !draft.adSetData) {
      throw new NotFoundException(
        'Campaign draft not found. Complete Steps 1 and 2 first.',
      );
    }

    this.assertAdCreativeStepBusinessRules(dto);
    assertAdCreativeMedia(dto);
    assertAdCreativeDestinationUrl(dto);

    const destinationUrl =
      dto.creativeFormat !== MetaCreativeFormat.CAROUSEL && dto.destinationUrl
        ? buildDestinationUrlWithParams(dto.destinationUrl, dto.urlParameters)
        : undefined;

    const adCreativeData: AdCreativeStepDataDto = {
      name: dto.name.trim(),
      draftId: dto.draftId.trim(),
      facebookPageId: dto.facebookPageId.trim(),
      instagramActorId: dto.instagramActorId?.trim() || undefined,
      status: dto.status,
      creativeFormat: dto.creativeFormat,
      imageUrl: dto.imageUrl
        ? (normalizeCampaignImageUrlForMeta(dto.imageUrl) ?? dto.imageUrl.trim())
        : undefined,
      imageAltText: dto.imageAltText?.trim() || undefined,
      videoUrl: dto.videoUrl?.trim(),
      thumbnailUrl: dto.thumbnailUrl?.trim(),
      carouselCards: dto.carouselCards?.map((card) => ({
        ...card,
        imageUrl: card.imageUrl
          ? (normalizeCampaignImageUrlForMeta(card.imageUrl) ??
            card.imageUrl.trim())
          : undefined,
        videoUrl: undefined,
        mediaType: 'image' as const,
        destinationUrl: buildDestinationUrlWithParams(
          card.destinationUrl,
          dto.urlParameters,
        ),
      })),
      primaryText: dto.primaryText.trim(),
      headline: dto.headline?.trim(),
      description: dto.description?.trim() || undefined,
      displayLink: dto.displayLink?.trim() || undefined,
      destinationUrl,
      urlParameters: dto.urlParameters?.trim() || undefined,
      callToAction: dto.callToAction,
      pixelId: dto.pixelId?.trim() || undefined,
      conversionEvent: dto.conversionEvent?.trim() || undefined,
      brandingEnabled: dto.brandingEnabled ?? undefined,
      brandName: dto.brandName?.trim() || undefined,
      brandLogoUrl: dto.brandLogoUrl?.trim() || undefined,
    };

    draft.adCreativeData = adCreativeData;
    draft.campaignId = this.resolveCampaignIdFromCreative(adCreativeData);
    draft.currentStep = Math.max(draft.currentStep, 4);
    draft.completedSteps = this.mergeCompletedSteps(draft.completedSteps, [
      1, 2, 3,
    ]);
    draft.lastSavedAt = new Date();
    draft.version = (draft.version ?? 1) + 1;
    const saved = await this.draftRepository.save(draft);
    return this.toResponse(saved);
  }

  async autosaveDraft(
    user: User,
    businessId: number,
    draftId: string,
    dto: AutosaveDraftDto,
  ): Promise<MetaCampaignDraftResponseDto> {
    await this.loadOwnedBusiness(user, businessId, 'create');

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      draftId.trim(),
    );

    if ((draft.version ?? 1) !== dto.expectedVersion) {
      throw new ConflictException({
        message:
          'Draft was updated elsewhere. Reload and try saving again.',
        currentVersion: draft.version ?? 1,
      });
    }

    if (dto.campaignData) {
      draft.campaignData = {
        ...((draft.campaignData as Record<string, unknown>) ?? {}),
        ...dto.campaignData,
      };
    }
    if (dto.adSetData) {
      draft.adSetData = {
        ...((draft.adSetData as Record<string, unknown>) ?? {}),
        ...dto.adSetData,
      };
    }
    if (dto.adCreativeData) {
      draft.adCreativeData = {
        ...((draft.adCreativeData as Record<string, unknown>) ?? {}),
        ...dto.adCreativeData,
      };
      draft.campaignId = this.resolveCampaignIdFromCreative(
        draft.adCreativeData as AdCreativeStepDataDto,
      );
    }

    if (dto.currentStep != null) {
      const step = Math.min(4, Math.max(1, Math.trunc(dto.currentStep)));
      draft.currentStep = step;
    }

    if (dto.completedSteps?.length) {
      draft.completedSteps = this.mergeCompletedSteps(
        draft.completedSteps,
        dto.completedSteps,
      );
    }

    draft.lastSavedAt = new Date();
    draft.version = (draft.version ?? 1) + 1;

    const saved = await this.draftRepository.save(draft);
    return this.toResponse(saved);
  }

  async getDraft(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<MetaCampaignDraftResponseDto> {
    await this.loadOwnedBusiness(user, businessId, 'view');

    const draft = await this.draftRepository.findOne({
      where: { id: draftId.trim(), businessId },
    });

    if (!draft) {
      throw new NotFoundException('Campaign draft not found.');
    }

    return this.toResponse(draft);
  }

  async listDrafts(
    user: User,
    businessId: number,
  ): Promise<MetaCampaignDraftResponseDto[]> {
    const business = await this.loadOwnedBusiness(user, businessId, 'view');

    const drafts = await this.draftRepository.find({
      where: {
        businessId,
      },
      order: { updatedAt: 'DESC' },
    });

    const synced = await this.syncPublishedDraftsWithMeta(business, drafts);

    return synced.map((draft) => this.toResponse(draft));
  }

  private async syncPublishedDraftsWithMeta(
    business: Business,
    drafts: MetaCampaignDraft[],
  ): Promise<MetaCampaignDraft[]> {
    const published = drafts.filter((draft) => {
      const status = (draft.status ?? '').toLowerCase();
      const publishStatus = (draft.publishStatus ?? '').toUpperCase();
      return (
        Boolean(draft.metaCampaignId?.trim()) &&
        (status === 'published' ||
          publishStatus === 'PUBLISHED' ||
          Boolean(draft.metaAdId))
      );
    });

    if (published.length === 0) {
      return drafts;
    }

    let liveIds: Set<string>;
    try {
      liveIds = await this.fetchLiveMetaCampaignIds(business);
    } catch (err) {
      this.logger.warn(
        `Could not sync Meta campaigns for business ${business.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return drafts;
    }

    const missing = published.filter(
      (draft) => !liveIds.has(String(draft.metaCampaignId).trim()),
    );
    if (missing.length === 0) {
      return drafts;
    }

    const missingIds = missing.map((draft) => draft.id);
    const missingMetaIds = missing
      .map((draft) => draft.metaCampaignId?.trim())
      .filter((id): id is string => Boolean(id));

    await this.draftRepository.delete({ id: In(missingIds) });
    if (missingMetaIds.length > 0) {
      await this.facebookCampaignRepository.delete({
        businessId: business.id,
        metaCampaignId: In(missingMetaIds),
      });
    }

    this.logger.log(
      `Synced Meta campaigns for business ${business.id}: removed ${missing.length} deleted campaign(s).`,
    );

    const removed = new Set(missingIds);
    return drafts.filter((draft) => !removed.has(draft.id));
  }

  private async fetchLiveMetaCampaignIds(
    business: Business,
  ): Promise<Set<string>> {
    const { accessToken, adAccountId: storedAdAccountId } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);
    const adAccountId = normalizeAdAccountId(storedAdAccountId ?? '');
    const live = new Set<string>();
    let after: string | undefined;

    for (let page = 0; page < 20; page += 1) {
      const params: Record<string, string> = {
        fields: 'id,status,effective_status',
        limit: '100',
      };
      if (after) {
        params.after = after;
      }

      const response = await graphGetWithToken<{
        data?: Array<{
          id?: string;
          status?: string;
          effective_status?: string;
        }>;
        paging?: { cursors?: { after?: string }; next?: string };
      }>(`/${adAccountId}/campaigns`, accessToken, params);

      for (const row of response.data ?? []) {
        const id = row.id?.trim();
        if (!id) continue;
        const effective = (row.effective_status ?? '').toUpperCase();
        const status = (row.status ?? '').toUpperCase();
        if (effective === 'DELETED' || status === 'DELETED') {
          continue;
        }
        live.add(id);
      }

      const nextAfter = response.paging?.cursors?.after?.trim();
      const hasNext = Boolean(response.paging?.next && nextAfter);
      if (!hasNext || !(response.data?.length ?? 0)) {
        break;
      }
      after = nextAfter;
    }

    return live;
  }

  async deleteDraft(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<{ deleted: true; draftId: string }> {
    await this.loadOwnedBusiness(user, businessId, 'create');

    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        businessId,
      },
    });

    if (!draft) {
      throw new NotFoundException('Campaign draft not found.');
    }

    const status = (draft.status ?? '').toLowerCase();
    const publishStatus = (draft.publishStatus ?? '').toUpperCase();
    const isPublishing =
      status === 'publishing' ||
      publishStatus === 'QUEUED' ||
      publishStatus === 'PUBLISHING' ||
      publishStatus === 'RUNNING';
    if (isPublishing) {
      throw new BadRequestException(
        'This campaign is publishing. Wait for it to finish before deleting.',
      );
    }

    await this.draftRepository.remove(draft);

    return { deleted: true, draftId: draft.id };
  }

  private mergeCompletedSteps(
    existing: number[] | null | undefined,
    next: number[],
  ): number[] {
    return [...new Set([...(existing ?? []), ...next])].sort((a, b) => a - b);
  }

  private assertCampaignStepBusinessRules(dto: SaveCampaignStepDto): void {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Campaign name is required.');
    }

    if (!dto.objective) {
      throw new BadRequestException('Campaign objective is required.');
    }

    if (!Array.isArray(dto.specialAdCategories)) {
      throw new BadRequestException('Special ad categories selection is required.');
    }

    if (dto.budgetStrategy === MetaBudgetStrategy.CAMPAIGN) {
      if (!dto.campaignBudgetType) {
        throw new BadRequestException(
          'Select daily or lifetime budget for campaign budget.',
        );
      }

      const hasDaily =
        dto.campaignBudgetType === MetaAdSetBudgetType.DAILY &&
        dto.campaignDailyBudget != null &&
        dto.campaignDailyBudget >= 1;
      const hasLifetime =
        dto.campaignBudgetType === MetaAdSetBudgetType.LIFETIME &&
        dto.campaignLifetimeBudget != null &&
        dto.campaignLifetimeBudget >= 1;

      if (!hasDaily && !hasLifetime) {
        throw new BadRequestException(
          'Campaign budget amount is required when using Campaign budget (Advantage+).',
        );
      }

      if (!dto.campaignBidStrategy) {
        throw new BadRequestException(
          'Campaign bid strategy is required when using Campaign budget.',
        );
      }
    }
  }

  private assertAdSetStepBusinessRules(
    dto: SaveAdSetStepDto,
    campaignData: CampaignStepDataDto,
  ): void {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Ad set name is required.');
    }

    if (!dto.audience?.country?.trim()) {
      throw new BadRequestException('Country is required for audience targeting.');
    }

    if (dto.audience.ageMin > dto.audience.ageMax) {
      throw new BadRequestException('Minimum age cannot exceed maximum age.');
    }

    assertAudienceCityRadius(
      dto.audience.city,
      dto.audience.radius,
      dto.audience.distanceUnit,
    );

    assertOptimizationGoalForObjective(
      campaignData.objective as MetaCampaignObjective,
      dto.optimizationGoal,
    );

    assertAtLeastOnePlacement(dto.placements);

    if (!campaignData.campaignBudgetOptimization) {
      if (!dto.budgetType) {
        throw new BadRequestException('Budget type is required for ad set budget mode.');
      }
      const hasDaily =
        dto.budgetType === MetaAdSetBudgetType.DAILY &&
        dto.dailyBudget != null &&
        dto.dailyBudget >= 1;
      const hasLifetime =
        dto.budgetType === MetaAdSetBudgetType.LIFETIME &&
        dto.lifetimeBudget != null &&
        dto.lifetimeBudget >= 1;

      if (!hasDaily && !hasLifetime) {
        throw new BadRequestException(
          'Ad set daily or lifetime budget is required when using Ad set budget.',
        );
      }
    }
  }

  private assertAdCreativeStepBusinessRules(dto: SaveAdCreativeStepDto): void {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Ad name is required.');
    }

    if (!dto.facebookPageId?.trim()) {
      throw new BadRequestException('Facebook Page is required.');
    }

    if (!dto.primaryText?.trim()) {
      throw new BadRequestException('Primary text is required.');
    }

    if (dto.creativeFormat !== MetaCreativeFormat.CAROUSEL) {
      if (!dto.headline?.trim()) {
        throw new BadRequestException('Headline is required.');
      }
      if (!dto.destinationUrl?.trim()) {
        throw new BadRequestException('Destination URL is required.');
      }
      if (!dto.callToAction) {
        throw new BadRequestException('Call to action is required.');
      }
    }
  }

  async importLiveCampaignForBuilder(
    user: User,
    businessId: number,
    metaCampaignId: string,
  ): Promise<MetaCampaignDraftResponseDto> {
    const campaignId = metaCampaignId.trim();
    if (!campaignId) {
      throw new BadRequestException('Meta campaign id is required.');
    }

    const business = await this.loadOwnedBusiness(user, businessId, 'create');
    const { accessToken, adAccountId: storedAdAccountId } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);
    const adAccountId = normalizeAdAccountId(storedAdAccountId ?? '');

    const liveCampaign = await graphGetWithToken<{
      id?: string;
      name?: string;
      objective?: string;
      status?: string;
      buying_type?: string;
      special_ad_categories?: string[];
      daily_budget?: string;
      lifetime_budget?: string;
    }>(campaignId, accessToken, {
      fields:
        'id,name,objective,status,buying_type,special_ad_categories,daily_budget,lifetime_budget',
    });

    const adSetsResponse = await graphGetWithToken<{
      data?: Array<{
        id?: string;
        name?: string;
        status?: string;
        daily_budget?: string;
        lifetime_budget?: string;
        optimization_goal?: string;
        billing_event?: string;
        bid_strategy?: string;
        start_time?: string;
        end_time?: string;
        destination_type?: string;
        targeting?: Record<string, unknown>;
        promoted_object?: {
          page_id?: string;
          pixel_id?: string;
          custom_event_type?: string;
        };
      }>;
    }>(`${campaignId}/adsets`, accessToken, {
      fields:
        'id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,start_time,end_time,destination_type,targeting,promoted_object',
      limit: '1',
    });

    const liveAdSet = adSetsResponse.data?.[0];
    if (!liveAdSet?.id) {
      throw new BadRequestException(
        'This Meta campaign has no ad set to import into the builder.',
      );
    }

    const adsResponse = await graphGetWithToken<{
      data?: Array<{
        id?: string;
        name?: string;
        status?: string;
        creative?: {
          id?: string;
          name?: string;
          thumbnail_url?: string;
          image_url?: string;
          object_story_spec?: {
            page_id?: string;
            instagram_actor_id?: string;
            link_data?: {
              message?: string;
              name?: string;
              description?: string;
              link?: string;
              image_hash?: string;
              call_to_action?: { type?: string; value?: { link?: string } };
              picture?: string;
            };
            video_data?: {
              video_id?: string;
              image_url?: string;
              message?: string;
              title?: string;
              call_to_action?: { type?: string; value?: { link?: string } };
            };
          };
        };
      }>;
    }>(`${liveAdSet.id}/ads`, accessToken, {
      fields:
        'id,name,status,creative{id,name,thumbnail_url,image_url,object_story_spec}',
      limit: '1',
    });

    const liveAd = adsResponse.data?.[0];
    if (!liveAd?.id) {
      throw new BadRequestException(
        'This Meta campaign has no ad to import into the builder.',
      );
    }

    const mapped = this.mapLiveMetaToDraftData({
      campaign: liveCampaign,
      adSet: liveAdSet,
      ad: liveAd,
      draftIdPlaceholder: 'pending',
    });

    const now = new Date();
    const existing = await this.draftRepository.findOne({
      where: {
        businessId,
        userId: user.id,
        metaCampaignId: campaignId,
      },
    });

    const draftPayload: Partial<MetaCampaignDraft> = {
      userId: user.id,
      businessId,
      currentStep: 4,
      status: 'draft',
      campaignData: mapped.campaignData as unknown as Record<string, unknown>,
      adSetData: mapped.adSetData as unknown as Record<string, unknown>,
      adCreativeData: mapped.adCreativeData as unknown as Record<
        string,
        unknown
      >,
      campaignId: this.resolveCampaignIdFromCreative(mapped.adCreativeData),
      metaCampaignId: campaignId,
      metaAdsetId: liveAdSet.id,
      metaCreativeId: liveAd.creative?.id?.trim() || null,
      metaAdId: liveAd.id,
      completedSteps: [1, 2, 3],
      lastSavedAt: now,
      errorMessage: null,
      publishStatus: null,
      publishJobId: null,
      publishStep: null,
      publishProgress: 0,
      publishedAt: null,
    };

    let saved: MetaCampaignDraft;
    if (existing) {
      Object.assign(existing, draftPayload);
      existing.version = (existing.version ?? 1) + 1;
      const adSet = existing.adSetData as AdSetStepDataDto | null;
      const creative = existing.adCreativeData as AdCreativeStepDataDto | null;
      if (adSet) adSet.draftId = existing.id;
      if (creative) creative.draftId = existing.id;
      existing.adSetData = adSet as unknown as Record<string, unknown>;
      existing.adCreativeData = creative as unknown as Record<string, unknown>;
      saved = await this.draftRepository.save(existing);
    } else {
      saved = await this.draftRepository.save({
        ...draftPayload,
        version: 1,
      } as MetaCampaignDraft);
      const adSet = saved.adSetData as AdSetStepDataDto | null;
      const creative = saved.adCreativeData as AdCreativeStepDataDto | null;
      if (adSet) adSet.draftId = saved.id;
      if (creative) creative.draftId = saved.id;
      saved.adSetData = adSet as unknown as Record<string, unknown>;
      saved.adCreativeData = creative as unknown as Record<string, unknown>;
      saved = await this.draftRepository.save(saved);
    }

    const [tracking] = await this.facebookCampaignRepository.find({
      where: { businessId, metaCampaignId: campaignId },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    if (tracking) {
      await this.facebookCampaignRepository.update(tracking.id, {
        draftId: saved.id,
        metaAdsetId: liveAdSet.id,
        metaCreativeId: liveAd.creative?.id?.trim() || tracking.metaCreativeId,
        metaAdId: liveAd.id,
        campaignName: liveCampaign.name?.trim() || tracking.campaignName,
        status: liveCampaign.status?.trim() || tracking.status,
      });
    } else if (adAccountId) {
      await this.facebookCampaignRepository.save({
        userId: user.id,
        businessId,
        draftId: saved.id,
        adAccountId,
        metaCampaignId: campaignId,
        metaAdsetId: liveAdSet.id,
        metaCreativeId: liveAd.creative?.id?.trim() || null,
        metaAdId: liveAd.id,
        campaignName: liveCampaign.name?.trim() || null,
        objective: liveCampaign.objective?.trim() || null,
        status: liveCampaign.status?.trim() || 'PAUSED',
      });
    }

    this.logger.log(
      `Imported Meta campaign ${campaignId} into draft ${saved.id} for business ${businessId}`,
    );

    return this.toResponse(saved);
  }

  private mapLiveMetaToDraftData(input: {
    campaign: {
      name?: string;
      objective?: string;
      status?: string;
      buying_type?: string;
      special_ad_categories?: string[];
      daily_budget?: string;
      lifetime_budget?: string;
    };
    adSet: {
      id?: string;
      name?: string;
      status?: string;
      daily_budget?: string;
      lifetime_budget?: string;
      optimization_goal?: string;
      billing_event?: string;
      bid_strategy?: string;
      start_time?: string;
      end_time?: string;
      destination_type?: string;
      targeting?: Record<string, unknown>;
      promoted_object?: {
        page_id?: string;
        pixel_id?: string;
        custom_event_type?: string;
      };
    };
    ad: {
      id?: string;
      name?: string;
      status?: string;
      creative?: {
        id?: string;
        name?: string;
        thumbnail_url?: string;
        image_url?: string;
        object_story_spec?: {
          page_id?: string;
          instagram_actor_id?: string;
          link_data?: {
            message?: string;
            name?: string;
            description?: string;
            link?: string;
            call_to_action?: { type?: string; value?: { link?: string } };
            picture?: string;
          };
          video_data?: {
            video_id?: string;
            image_url?: string;
            message?: string;
            title?: string;
            call_to_action?: { type?: string; value?: { link?: string } };
          };
        };
      };
    };
    draftIdPlaceholder: string;
  }): {
    campaignData: CampaignStepDataDto;
    adSetData: AdSetStepDataDto;
    adCreativeData: AdCreativeStepDataDto;
  } {
    const objective = this.normalizeMetaObjective(input.campaign.objective);
    const campaignDaily =
      this.metaMinorToDollars(input.campaign.daily_budget) ?? undefined;
    const campaignLifetime =
      this.metaMinorToDollars(input.campaign.lifetime_budget) ?? undefined;
    const cbo = campaignDaily != null || campaignLifetime != null;

    const campaignData: CampaignStepDataDto = {
      name: input.campaign.name?.trim() || 'Imported Meta campaign',
      buyingType: input.campaign.buying_type?.trim() || 'AUCTION',
      objective,
      specialAdCategories: Array.isArray(input.campaign.special_ad_categories)
        ? input.campaign.special_ad_categories
        : [],
      campaignBudgetOptimization: cbo,
      budgetStrategy: cbo ? MetaBudgetStrategy.CAMPAIGN : MetaBudgetStrategy.ADSET,
      campaignBudgetType: campaignLifetime != null ? 'lifetime' : 'daily',
      campaignDailyBudget: campaignDaily,
      campaignLifetimeBudget: campaignLifetime,
      campaignBidStrategy: MetaBidStrategy.LOWEST_COST_WITHOUT_CAP,
      budgetScheduling: 'none',
      status:
        input.campaign.status === 'ACTIVE'
          ? MetaCampaignStatus.ACTIVE
          : MetaCampaignStatus.PAUSED,
    };

    const targeting = input.adSet.targeting ?? {};
    const geo =
      (targeting.geo_locations as Record<string, unknown> | undefined) ?? {};
    const countries = Array.isArray(geo.countries)
      ? (geo.countries as string[])
      : [];
    const ageMin =
      typeof targeting.age_min === 'number' ? targeting.age_min : 18;
    const ageMax =
      typeof targeting.age_max === 'number' ? targeting.age_max : 65;
    const genders = Array.isArray(targeting.genders)
      ? (targeting.genders as number[])
      : [];
    const gender =
      genders.length === 1 && genders[0] === 1
        ? MetaGender.MALE
        : genders.length === 1 && genders[0] === 2
          ? MetaGender.FEMALE
          : MetaGender.ALL;

    const startIso = input.adSet.start_time?.trim() || new Date().toISOString();
    const startDate = startIso.slice(0, 10);
    const startTime = startIso.includes('T')
      ? startIso.slice(11, 16) || '00:00'
      : '00:00';
    const endIso = input.adSet.end_time?.trim() || undefined;
    const endDate = endIso ? endIso.slice(0, 10) : undefined;
    const endTime =
      endIso && endIso.includes('T') ? endIso.slice(11, 16) || undefined : undefined;

    const adSetDaily =
      this.metaMinorToDollars(input.adSet.daily_budget) ?? undefined;
    const adSetLifetime =
      this.metaMinorToDollars(input.adSet.lifetime_budget) ?? undefined;

    const adSetData: AdSetStepDataDto = {
      name: input.adSet.name?.trim() || `${campaignData.name} — Ad set`,
      draftId: input.draftIdPlaceholder,
      status:
        input.adSet.status === 'ACTIVE'
          ? MetaCampaignStatus.ACTIVE
          : MetaCampaignStatus.PAUSED,
      budgetType:
        adSetLifetime != null
          ? MetaAdSetBudgetType.LIFETIME
          : MetaAdSetBudgetType.DAILY,
      dailyBudget: adSetDaily ?? (cbo ? undefined : 20),
      lifetimeBudget: adSetLifetime,
      bidStrategy:
        (input.adSet.bid_strategy as MetaBidStrategy) ||
        MetaBidStrategy.LOWEST_COST_WITHOUT_CAP,
      billingEvent: input.adSet.billing_event?.trim() || 'IMPRESSIONS',
      startDate,
      startTime,
      endDate,
      endTime,
      timezone: 'UTC',
      startDateTime: `${startDate}T${startTime}:00`,
      endDateTime:
        endDate && endTime ? `${endDate}T${endTime}:00` : undefined,
      optimizationGoal:
        input.adSet.optimization_goal?.trim() || 'LINK_CLICKS',
      destinationType: input.adSet.destination_type?.trim() || 'WEBSITE',
      promotedObject: {
        pageId: input.adSet.promoted_object?.page_id,
        pixelId: input.adSet.promoted_object?.pixel_id,
        customEventType: input.adSet.promoted_object?.custom_event_type,
      },
      audience: {
        country: countries[0] || 'US',
        locations: countries.map((code) => ({
          id: `loc-${code}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          mode: 'include' as const,
          type: 'country' as const,
          countryCode: code,
          countryName: code,
          label: code,
          metaKey: code,
          metaType: 'country' as const,
        })),
        ageMin,
        ageMax,
        gender,
        languages: [],
        interests: [],
        behaviors: [],
        demographics: [],
      },
      placements: {
        advantagePlusPlacements: true,
        devicePlatforms: { mobile: true, desktop: true },
        publisherPlatforms: {
          facebook: true,
          instagram: true,
          audienceNetwork: false,
          messenger: false,
        },
        facebookPositions: {
          feed: true,
          story: true,
          reels: true,
          marketplace: true,
          videoFeeds: true,
        },
        instagramPositions: {
          stream: true,
          story: true,
          reels: true,
          explore: true,
        },
      },
    };

    const story = input.ad.creative?.object_story_spec;
    const linkData = story?.link_data;
    const videoData = story?.video_data;
    const isVideo = Boolean(videoData?.video_id);
    const pageId =
      story?.page_id?.trim() ||
      input.adSet.promoted_object?.page_id?.trim() ||
      '';
    const imageUrl =
      input.ad.creative?.image_url?.trim() ||
      linkData?.picture?.trim() ||
      input.ad.creative?.thumbnail_url?.trim() ||
      videoData?.image_url?.trim() ||
      undefined;
    const destinationUrl =
      linkData?.link?.trim() ||
      linkData?.call_to_action?.value?.link?.trim() ||
      videoData?.call_to_action?.value?.link?.trim() ||
      'https://example.com';
    const cta =
      linkData?.call_to_action?.type?.trim() ||
      videoData?.call_to_action?.type?.trim() ||
      'LEARN_MORE';

    const adCreativeData: AdCreativeStepDataDto = {
      name: input.ad.name?.trim() || input.ad.creative?.name?.trim() || 'Ad',
      draftId: input.draftIdPlaceholder,
      facebookPageId: pageId || '0',
      instagramActorId: story?.instagram_actor_id?.trim() || undefined,
      status:
        input.ad.status === 'ACTIVE'
          ? MetaCampaignStatus.ACTIVE
          : MetaCampaignStatus.PAUSED,
      creativeFormat: isVideo
        ? MetaCreativeFormat.SINGLE_VIDEO
        : MetaCreativeFormat.SINGLE_IMAGE,
      imageUrl: isVideo ? undefined : imageUrl,
      videoUrl: isVideo ? undefined : undefined,
      thumbnailUrl: isVideo ? imageUrl : undefined,
      primaryText:
        linkData?.message?.trim() ||
        videoData?.message?.trim() ||
        'Learn more',
      headline: linkData?.name?.trim() || videoData?.title?.trim() || undefined,
      description: linkData?.description?.trim() || undefined,
      destinationUrl,
      callToAction: cta,
    };

    return { campaignData, adSetData, adCreativeData };
  }

  private normalizeMetaObjective(raw?: string): string {
    const value = (raw ?? '').trim().toUpperCase();
    const allowed = new Set(Object.values(MetaCampaignObjective));
    if (allowed.has(value as MetaCampaignObjective)) return value;
    if (value.includes('TRAFFIC') || value === 'LINK_CLICKS') {
      return MetaCampaignObjective.OUTCOME_TRAFFIC;
    }
    if (value.includes('LEAD')) return MetaCampaignObjective.OUTCOME_LEADS;
    if (value.includes('SALES') || value.includes('CONVERSION')) {
      return MetaCampaignObjective.OUTCOME_SALES;
    }
    if (value.includes('ENGAGEMENT') || value.includes('POST')) {
      return MetaCampaignObjective.OUTCOME_ENGAGEMENT;
    }
    if (value.includes('AWARENESS') || value.includes('REACH')) {
      return MetaCampaignObjective.OUTCOME_AWARENESS;
    }
    return MetaCampaignObjective.OUTCOME_TRAFFIC;
  }

  private metaMinorToDollars(minor?: string | null): number | null {
    if (minor == null || String(minor).trim() === '') return null;
    const n = Number(minor);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round((n / 100) * 100) / 100;
  }

  private async findEditableDraft(
    userId: number,
    businessId: number,
    draftId: string,
  ): Promise<MetaCampaignDraft> {
    void userId;
    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        businessId,
      },
    });

    if (!draft) {
      throw new NotFoundException('Campaign draft not found.');
    }

    if (draft.status === 'published' && draft.metaAdId && !draft.metaCampaignId) {
      throw new BadRequestException(
        'This campaign was already published. Create a new campaign to make changes.',
      );
    }

    if (draft.status === 'publishing') {
      const updatedAt = draft.updatedAt?.getTime?.() ?? 0;
      const staleMs = 15 * 60 * 1000;
      if (Date.now() - updatedAt < staleMs) {
        throw new BadRequestException(
          'Publish is in progress. Wait for it to finish before editing this draft.',
        );
      }
    }

    if (draft.status !== 'draft') {
      draft.status = 'draft';
      draft.errorMessage = null;
      draft.publishStatus = null;
      await this.draftRepository.save(draft);
    }

    return draft;
  }

  private async loadOwnedBusiness(
    user: User,
    businessId: number,
    action: MetaCampaignAccessAction = 'view',
  ): Promise<Business> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      metaCampaignPermissionKeysFor(action),
      'You do not have permission to access Meta campaigns for this business.',
    );
    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    if (action === 'create' || action === 'delete') {
      assertBusinessCanManageMetaAds(business.metaOauthScopes);
    }

    return business;
  }

  private resolveCampaignIdFromCreative(
    creative: AdCreativeStepDataDto | null | undefined,
  ): number | null {
    const destinationUrl =
      creative?.destinationUrl?.trim() ||
      creative?.carouselCards?.[0]?.destinationUrl?.trim() ||
      null;
    return parseCampaignIdFromDestinationUrl(destinationUrl);
  }

  private toResponse(draft: MetaCampaignDraft): MetaCampaignDraftResponseDto {
    return {
      id: draft.id,
      businessId: draft.businessId,
      campaignId: draft.campaignId ?? null,
      currentStep: draft.currentStep,
      status: draft.status,
      campaignData: (draft.campaignData as CampaignStepDataDto | null) ?? null,
      adSetData: (draft.adSetData as AdSetStepDataDto | null) ?? null,
      adCreativeData:
        (draft.adCreativeData as AdCreativeStepDataDto | null) ?? null,
      metaCampaignId: draft.metaCampaignId,
      metaAdsetId: draft.metaAdsetId,
      metaCreativeId: draft.metaCreativeId,
      metaAdId: draft.metaAdId,
      errorMessage: draft.errorMessage,
      version: draft.version ?? 1,
      completedSteps: draft.completedSteps ?? [],
      lastSavedAt: draft.lastSavedAt,
      publishStatus: draft.publishStatus,
      publishJobId: draft.publishJobId,
      publishStep: draft.publishStep,
      publishProgress: draft.publishProgress ?? 0,
      publishedAt: draft.publishedAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }
}
