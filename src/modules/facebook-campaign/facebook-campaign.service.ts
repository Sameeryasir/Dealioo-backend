import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { MetaCampaignError } from '../../db/entities/meta-campaign-error.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import { BusinessHistoryService } from '../business-history/business-history.service';
import {
  metaCampaignPermissionKeysFor,
  type MetaCampaignAccessAction,
} from '../member/member.constants';
import { assertBusinessCanManageMetaAds } from '../facebook/facebook-oauth-scopes.util';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  toAbsoluteAssetUrlIfRelative,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { FacebookMetaTokenService } from '../facebook/facebook-meta-token.service';
import { FacebookService } from '../facebook/facebook.service';
import { CreateFacebookCampaignDto } from './dto/create-facebook-campaign.dto';
import { CreateFacebookCampaignResponseDto } from './dto/create-facebook-campaign-response.dto';
import { MediaService } from './media.service';
import {
  adsManagerCampaignsUrl,
  assertAgeRange,
  assertDirectMetaImageUrl,
  assertDirectMetaVideoUrl,
  assertMediaProvided,
  assertScheduleRange,
  buildAdPayload,
  buildAdSetPayload,
  buildCampaignPayload,
  buildCreativePayload,
  dailyBudgetToMetaMinorUnits,
  deleteMetaObject,
  genderToMetaGenders,
  graphGetWithToken,
  MetaApiStepError,
  normalizeAdAccountId,
  resolveCityTargetingKey,
  stepFailureUserMessage,
  toMetaUnixTime,
  updateMetaObject,
} from './facebook-campaign-meta';
import {
  sdkCreateAd,
  sdkCreateAdCreative,
  sdkCreateAdSet,
  sdkCreateCampaign,
  sdkUploadAdImageHash,
  sdkUploadAdVideoId,
} from './meta-business-sdk';
import {
  MetaCreationStep,
  MetaDistanceUnit,
} from './meta-campaign.constants';

type MetaPageListResponse = {
  data?: Array<{ id?: string; name?: string }>;
};

type MetaAdAccountResponse = {
  account_status?: number;
  name?: string;
};

@Injectable()
export class FacebookCampaignService {
  private readonly logger = new Logger(FacebookCampaignService.name);

  constructor(
    @InjectRepository(FacebookCampaign)
    private readonly facebookCampaignRepository: Repository<FacebookCampaign>,
    @InjectRepository(MetaCampaignDraft)
    private readonly metaCampaignDraftRepository: Repository<MetaCampaignDraft>,
    @InjectRepository(MetaCampaignError)
    private readonly metaCampaignErrorRepository: Repository<MetaCampaignError>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly businessAccessService: BusinessAccessService,
    private readonly businessHistoryService: BusinessHistoryService,
    private readonly metaTokenService: FacebookMetaTokenService,
    private readonly facebookService: FacebookService,
    private readonly spacesService: SpacesService,
    private readonly metaCampaignMediaService: MediaService,
  ) {}

  async uploadAdImageForBusiness(
    user: User,
    businessId: number,
    file: Express.Multer.File,
  ): Promise<{ imageUrl: string }> {
    await this.loadOwnedBusiness(user, businessId, 'create');

    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    const imageUrl = await persistUploadedFile(
      this.spacesService,
      file,
      CAMPAIGNS_UPLOAD_SUBDIR,
      'absolute',
    );

    if (!imageUrl?.startsWith('https://')) {
      throw new BadRequestException(
        'PUBLIC_BASE_URL must use HTTPS so Meta can download the ad image on publish.',
      );
    }

    await this.metaCampaignMediaService.recordServerUpload({
      userId: user.id,
      businessId,
      draftId: null,
      mediaType: 'image',
      filename: file.originalname || 'ad-image',
      mimeType: file.mimetype || 'image/jpeg',
      sizeBytes: file.size ?? file.buffer?.length ?? 0,
      storageUrl: imageUrl,
    });

    return { imageUrl };
  }

  async uploadAdVideoForBusiness(
    user: User,
    businessId: number,
    file: Express.Multer.File,
  ): Promise<{ videoUrl: string }> {

    await this.loadOwnedBusiness(user, businessId, 'create');

    if (!file) {
      throw new BadRequestException('Video file is required.');
    }

    const videoUrl = await persistUploadedFile(
      this.spacesService,
      file,
      CAMPAIGNS_UPLOAD_SUBDIR,
      'absolute',
    );

    if (!videoUrl?.startsWith('https://')) {
      throw new BadRequestException(
        'PUBLIC_BASE_URL must use HTTPS so Meta can download the ad video.',
      );
    }

    await this.metaCampaignMediaService.recordServerUpload({
      userId: user.id,
      businessId,
      draftId: null,
      mediaType: 'video',
      filename: file.originalname || 'ad-video',
      mimeType: file.mimetype || 'video/mp4',
      sizeBytes: file.size ?? file.buffer?.length ?? 0,
      storageUrl: videoUrl,
    });

    return { videoUrl };
  }

  async createForBusiness(
    user: User,
    businessId: number,
    dto: CreateFacebookCampaignDto,
  ): Promise<CreateFacebookCampaignResponseDto> {

    const business = await this.loadOwnedBusiness(user, businessId, 'create');

    const { accessToken, adAccountId: storedAdAccountId } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);

    const adAccountId = normalizeAdAccountId(storedAdAccountId ?? '');

    assertMediaProvided(dto);
    assertScheduleRange(dto.startDate, dto.endDate);
    assertAgeRange(dto.ageMin, dto.ageMax);

    const imageUrl = dto.imageUrl?.trim()
      ? (toAbsoluteAssetUrlIfRelative(dto.imageUrl.trim()) ??
        dto.imageUrl.trim())
      : undefined;
    const videoUrl = dto.videoUrl?.trim()
      ? (toAbsoluteAssetUrlIfRelative(dto.videoUrl.trim()) ??
        dto.videoUrl.trim())
      : undefined;

    if (imageUrl) {
      assertDirectMetaImageUrl(imageUrl);
    }
    if (videoUrl) {
      assertDirectMetaVideoUrl(videoUrl);
    }

    await this.ensureAdAccountActive(adAccountId, accessToken);
    await this.assertPageAccessible(dto.facebookPageId.trim(), accessToken);

    const dailyBudgetMinor = dailyBudgetToMetaMinorUnits(dto.dailyBudget);
    const startTime = toMetaUnixTime(dto.startDate);
    const endTime = toMetaUnixTime(dto.endDate);
    const genders = genderToMetaGenders(dto.gender);
    const specialAdCategories = dto.specialAdCategories ?? [];

    let cityKey: string | undefined;
    if (dto.city?.trim()) {
      if (!dto.radius || !dto.distanceUnit) {
        throw new BadRequestException(
          'City targeting requires radius and distance unit (mile or kilometer).',
        );
      }
      cityKey = await resolveCityTargetingKey(
        accessToken,
        dto.country,
        dto.city,
      );
    }

    const tracking = await this.facebookCampaignRepository.save({
      userId: user.id,
      businessId,
      adAccountId,
      campaignName: dto.name.trim(),
      objective: dto.objective,
      budget: String(dto.dailyBudget),
      startTime: new Date(dto.startDate),
      endTime: new Date(dto.endDate),
      facebookPageId: dto.facebookPageId.trim(),
      instagramActorId: dto.instagramActorId?.trim() || null,
      status: 'PENDING',
      errorMessage: null,
    });

    let metaCampaignId: string | null = null;
    let metaAdsetId: string | null = null;
    let metaCreativeId: string | null = null;

    try {
      this.logger.log(
        `Creating Meta campaign for business ${businessId} (tracking ${tracking.id})`,
      );
      metaCampaignId = await sdkCreateCampaign(
        accessToken,
        adAccountId,
        buildCampaignPayload({
          name: dto.name.trim(),
          objective: dto.objective,
          specialAdCategories,
        }),
      );
      await this.facebookCampaignRepository.update(tracking.id, {
        metaCampaignId,
      });

      metaAdsetId = await sdkCreateAdSet(
        accessToken,
        adAccountId,
        buildAdSetPayload({
          name: dto.adSetName?.trim() || `${dto.name.trim()} Ad Set`,
          campaignId: metaCampaignId,
          dailyBudgetMinor,
          objective: dto.objective,
          startTime,
          endTime,
          country: dto.country,
          cityKey,
          radius: dto.radius,
          distanceUnit: dto.distanceUnit ?? MetaDistanceUnit.MILE,
          ageMin: dto.ageMin,
          ageMax: dto.ageMax,
          genders,
          placements: dto.placements,
        }),
      );
      await this.facebookCampaignRepository.update(tracking.id, {
        metaAdsetId,
      });

      let imageHash: string | undefined;
      let videoId: string | undefined;

      if (imageUrl) {
        imageHash = await sdkUploadAdImageHash(
          accessToken,
          adAccountId,
          imageUrl,
        );
      } else if (videoUrl) {
        videoId = await sdkUploadAdVideoId(accessToken, adAccountId, videoUrl);
      }

      metaCreativeId = await sdkCreateAdCreative(
        accessToken,
        adAccountId,
        buildCreativePayload({
          pageId: dto.facebookPageId.trim(),
          instagramActorId: dto.instagramActorId,
          imageHash,
          videoId,
          destinationUrl: dto.destinationUrl.trim(),
          primaryText: dto.primaryText.trim(),
          headline: dto.headline.trim(),
          description: dto.description,
          callToAction: dto.callToAction,
          name: `${dto.name.trim()} Creative`,
        }),
      );
      await this.facebookCampaignRepository.update(tracking.id, {
        metaCreativeId,
      });

      const adId = await sdkCreateAd(
        accessToken,
        adAccountId,
        buildAdPayload({
          name: dto.adName?.trim() || `${dto.name.trim()} Ad`,
          adsetId: metaAdsetId,
          creativeId: metaCreativeId,
        }),
      );

      await this.facebookCampaignRepository.update(tracking.id, {
        metaAdId: adId,
        status: 'PAUSED',
        errorMessage: null,
      });

      this.facebookService.invalidateCampaignStatsCache(businessId);

      this.logger.log(
        `Meta campaign published for business ${businessId}: campaign=${metaCampaignId}, ad=${adId}`,
      );

      void this.businessHistoryService
        .logCampaignCreated({
          businessId,
          campaignId: metaCampaignId!,
          campaignName: dto.name.trim(),
          actorUserId: user.id,
          source: 'meta',
        })
        .catch(() => undefined);

      return {
        id: tracking.id,
        metaCampaignId: metaCampaignId!,
        metaAdsetId: metaAdsetId!,
        metaCreativeId: metaCreativeId!,
        metaAdId: adId,
        status: 'PAUSED',
        adsManagerUrl: adsManagerCampaignsUrl(adAccountId),
        message: 'Campaign published successfully',
      };
    } catch (err) {
      throw await this.handleCreationFailure(
        user.id,
        businessId,
        tracking.id,
        err,
        {
          metaCampaignId,
          metaAdsetId,
          metaCreativeId,
        },
      );
    }
  }

  async deleteMetaCampaignForBusiness(
    user: User,
    businessId: number,
    metaCampaignId: string,
    providedCampaignName?: string,
  ): Promise<{ deleted: true; metaCampaignId: string }> {

    const campaignId = metaCampaignId.trim();
    if (!campaignId) {
      throw new BadRequestException('Meta campaign id is required.');
    }

    const business = await this.loadOwnedBusiness(user, businessId, 'delete');

    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);

    const localCampaign = await this.facebookCampaignRepository.findOne({
      where: { businessId, metaCampaignId: campaignId },
    });
    const localDraft = await this.metaCampaignDraftRepository.findOne({
      where: { businessId, metaCampaignId: campaignId },
    });
    const draftName =
      localDraft?.campaignData &&
      typeof (localDraft.campaignData as { name?: unknown }).name === 'string'
        ? String((localDraft.campaignData as { name: string }).name).trim()
        : '';

    let metaApiName = '';
    try {
      const metaCampaign = await graphGetWithToken<{ name?: string }>(
        campaignId,
        accessToken,
        { fields: 'name' },
      );
      metaApiName =
        typeof metaCampaign?.name === 'string' ? metaCampaign.name.trim() : '';
    } catch {
      metaApiName = '';
    }

    const campaignName =
      providedCampaignName?.trim() ||
      localCampaign?.campaignName?.trim() ||
      draftName ||
      metaApiName ||
      'Untitled Meta campaign';

    await deleteMetaObject(campaignId, accessToken);

    await this.facebookCampaignRepository.delete({
      businessId,
      metaCampaignId: campaignId,
    });

    await this.metaCampaignDraftRepository.delete({
      businessId,
      metaCampaignId: campaignId,
    });

    this.facebookService.invalidateCampaignStatsCache(businessId);

    this.logger.log(
      `Meta campaign ${campaignId} deleted for business ${businessId}`,
    );

    void this.businessHistoryService
      .logCampaignDeleted({
        businessId,
        campaignId,
        campaignName,
        actorUserId: user.id,
        source: 'meta',
      })
      .catch(() => undefined);

    return { deleted: true, metaCampaignId: campaignId };
  }

  async updatePublishedCampaignForBusiness(
    user: User,
    businessId: number,
    metaCampaignId: string,
    input: {
      name?: string;
      status?: 'ACTIVE' | 'PAUSED';
      dailyBudget?: number;
    },
  ): Promise<{
    updated: true;
    metaCampaignId: string;
    name: string | null;
    status: string | null;
    dailyBudget: string | null;
  }> {
    const campaignId = metaCampaignId.trim();
    if (!campaignId) {
      throw new BadRequestException('Meta campaign id is required.');
    }
    if (!input.name && !input.status && input.dailyBudget == null) {
      throw new BadRequestException('Provide a name, status, or daily budget.');
    }

    const business = await this.loadOwnedBusiness(user, businessId, 'create');
    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);

    const current = await graphGetWithToken<{
      name?: string;
      status?: string;
      daily_budget?: string;
    }>(campaignId, accessToken, {
      fields: 'name,status,effective_status,daily_budget',
    });

    const fields: Record<string, unknown> = {};
    const nextName = input.name?.trim();
    if (nextName) fields.name = nextName;
    if (input.status === 'ACTIVE' || input.status === 'PAUSED') {
      fields.status = input.status;
    }

    try {
      if (Object.keys(fields).length > 0) {
        await updateMetaObject(campaignId, accessToken, fields);
      }
      if (input.dailyBudget != null) {
        await this.updateMetaDailyBudget(
          campaignId,
          accessToken,
          input.dailyBudget,
          current.daily_budget,
        );
      }
    } catch (err) {
      if (err instanceof MetaApiStepError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const refreshed = await graphGetWithToken<{
      name?: string;
      status?: string;
      daily_budget?: string;
    }>(campaignId, accessToken, {
      fields: 'name,status,daily_budget',
    });

    let dailyBudget = refreshed.daily_budget ?? null;
    if (!dailyBudget && input.dailyBudget != null) {
      dailyBudget = dailyBudgetToMetaMinorUnits(input.dailyBudget);
    }

    await this.syncLocalPublishedCampaign(businessId, campaignId, {
      name: refreshed.name ?? nextName ?? null,
      status: refreshed.status ?? input.status ?? null,
      dailyBudgetDollars: input.dailyBudget ?? null,
    });

    this.facebookService.invalidateCampaignStatsCache(businessId);

    this.logger.log(
      `Meta campaign ${campaignId} updated for business ${businessId}`,
    );

    return {
      updated: true,
      metaCampaignId: campaignId,
      name: refreshed.name?.trim() || nextName || null,
      status: refreshed.status ?? input.status ?? null,
      dailyBudget,
    };
  }

  async updateCampaignStatusForBusiness(
    user: User,
    businessId: number,
    metaCampaignId: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<{
    updated: true;
    metaCampaignId: string;
    status: 'ACTIVE' | 'PAUSED';
  }> {
    const campaignId = metaCampaignId.trim();
    if (!campaignId) {
      throw new BadRequestException('Meta campaign id is required.');
    }
    if (status !== 'ACTIVE' && status !== 'PAUSED') {
      throw new BadRequestException(
        'Campaign status must be ACTIVE or PAUSED.',
      );
    }

    const business = await this.loadOwnedBusiness(user, businessId, 'create');
    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);

    try {
      await updateMetaObject(campaignId, accessToken, { status });
    } catch (err) {
      if (err instanceof MetaApiStepError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    await this.syncLocalPublishedCampaign(businessId, campaignId, { status });
    this.facebookService.invalidateCampaignStatsCache(businessId);

    this.logger.log(
      `Meta campaign ${campaignId} set to ${status} for business ${businessId}`,
    );

    return { updated: true, metaCampaignId: campaignId, status };
  }

  async listForBusiness(
    user: User,
    businessId: number,
  ): Promise<FacebookCampaign[]> {

    await this.loadOwnedBusiness(user, businessId, 'view');

    return this.facebookCampaignRepository.find({
      where: { businessId },
      order: { createdAt: 'DESC' },
    });
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

  private async updateMetaDailyBudget(
    campaignId: string,
    accessToken: string,
    dailyBudgetDollars: number,
    campaignDailyBudget?: string,
  ): Promise<void> {
    const minor = dailyBudgetToMetaMinorUnits(dailyBudgetDollars);
    const campaignHasBudget = Number(campaignDailyBudget ?? '') > 0;
    if (campaignHasBudget) {
      await updateMetaObject(campaignId, accessToken, {
        daily_budget: minor,
      });
      return;
    }

    const adSets = await graphGetWithToken<{
      data?: Array<{ id?: string; daily_budget?: string }>;
    }>(`${campaignId}/adsets`, accessToken, {
      fields: 'id,daily_budget',
      limit: '50',
    });
    const budgetAdSet =
      adSets.data?.find((row) => Number(row.daily_budget ?? '') > 0) ??
      adSets.data?.find((row) => row.id?.trim());
    if (!budgetAdSet?.id) {
      throw new BadRequestException(
        'This campaign has no daily budget in Meta to update. Set budget in Ads Manager, then try again.',
      );
    }
    await updateMetaObject(budgetAdSet.id, accessToken, {
      daily_budget: minor,
    });
  }

  private async syncLocalPublishedCampaign(
    businessId: number,
    metaCampaignId: string,
    input: {
      name?: string | null;
      status?: string | null;
      dailyBudgetDollars?: number | null;
    },
  ): Promise<void> {
    const patch: Partial<FacebookCampaign> = {};
    if (input.name?.trim()) patch.campaignName = input.name.trim();
    if (input.status?.trim()) patch.status = input.status.trim();
    if (input.dailyBudgetDollars != null) {
      patch.budget = String(input.dailyBudgetDollars);
    }
    if (Object.keys(patch).length === 0) return;

    await this.facebookCampaignRepository.update(
      { businessId, metaCampaignId },
      patch,
    );
  }


  private async handleCreationFailure(
    userId: number,
    businessId: number,
    trackingId: string,
    err: unknown,
    partial: {
      metaCampaignId: string | null;
      metaAdsetId: string | null;
      metaCreativeId: string | null;
    },
  ): Promise<never> {
    const step: MetaCreationStep =
      err instanceof MetaApiStepError ? err.step : 'campaign';
    const metaErrorCode =
      err instanceof MetaApiStepError ? err.metaErrorCode : null;
    const metaErrorMessage =
      err instanceof Error ? err.message : String(err);
    const rawResponse =
      err instanceof MetaApiStepError ? err.rawResponse : null;

    const userMessage = stepFailureUserMessage(step, metaErrorMessage);

    await this.facebookCampaignRepository.update(trackingId, {
      metaCampaignId: partial.metaCampaignId,
      metaAdsetId: partial.metaAdsetId,
      metaCreativeId: partial.metaCreativeId,
      status: 'FAILED',
      errorMessage: userMessage,
    });

    await this.metaCampaignErrorRepository.save({
      userId,
      businessId,
      facebookCampaignId: trackingId,
      step,
      metaErrorCode,
      metaErrorMessage,
      rawResponse,
    });

    this.logger.error(
      `Meta campaign creation failed at step=${step} for business ${businessId}: ${metaErrorMessage}`,
    );

    if (err instanceof MetaApiStepError) {
      throw new BadRequestException(userMessage);
    }

    if (err instanceof BadRequestException) {
      throw err;
    }

    throw new BadRequestException(userMessage);
  }

  private async assertPageAccessible(
    pageId: string,
    accessToken: string,
  ): Promise<void> {
    const response = await graphGetWithToken<MetaPageListResponse>(
      '/me/accounts',
      accessToken,
      { fields: 'id,name', limit: '50' },
    );

    const allowed = (response.data ?? []).some(
      (row) => row.id?.trim() === pageId,
    );

    if (!allowed) {
      throw new BadRequestException(
        'Selected Facebook Page is not linked to this Meta account.',
      );
    }
  }

  private async ensureAdAccountActive(
    adAccountId: string,
    accessToken: string,
  ): Promise<void> {
    const account = await graphGetWithToken<MetaAdAccountResponse>(
      `/${adAccountId}`,
      accessToken,
      { fields: 'account_status,name' },
    );

    if (account.account_status != null && account.account_status !== 1) {
      throw new BadRequestException(
        'This Meta ad account is disabled. Fix billing or status in Ads Manager, then try again.',
      );
    }
  }
}
