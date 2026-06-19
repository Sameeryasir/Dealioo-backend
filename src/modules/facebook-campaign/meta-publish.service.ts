import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { MetaCampaignError } from '../../db/entities/meta-campaign-error.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { toAbsoluteAssetUrlIfRelative } from '../../utils/disk-file-upload-multer';
import { FacebookIntegrationAuditService } from '../facebook/facebook-integration-audit.service';
import { FacebookMetaTokenService } from '../facebook/facebook-meta-token.service';
import { AdCreativeStepDataDto } from './dto/ad-creative-step-data.dto';
import { AdSetStepDataDto } from './dto/adset-step-data.dto';
import { CampaignStepDataDto } from './dto/meta-campaign-draft-response.dto';
import { PublishMetaCampaignResponseDto } from './dto/publish-meta-campaign-response.dto';
import {
  adsManagerCampaignsUrl,
  assertDirectMetaVideoUrl,
  graphGetWithToken,
  graphPostWithToken,
  MetaApiStepError,
  normalizeAdAccountId,
  stepFailureUserMessage,
  uploadAdImageHash,
  uploadAdVideoId,
} from './facebook-campaign-meta';
import {
  assertAdCreativeMedia,
  assertInstagramActorIfNeeded,
  buildDestinationUrlWithParams,
} from './meta-ad-creative-draft-validation';
import { MetaCreativeFormat, MetaCreationStep } from './meta-campaign.constants';
import {
  buildAdPayloadFromDraft,
  buildAdSetPayloadFromDraft,
  buildCampaignPayloadFromDraft,
  buildCreativePayloadFromDraft,
} from './meta-draft-payload-builders';
import { logMetaPublishStep } from './meta-publish-trace';

type MetaPageListResponse = {
  data?: Array<{ id?: string; name?: string }>;
};

type MetaAdAccountResponse = {
  account_status?: number;
  name?: string;
};

type PublishContext = {
  accessToken: string;
  adAccountId: string;
  campaign: CampaignStepDataDto;
  adSet: AdSetStepDataDto;
  creative: AdCreativeStepDataDto;
};

@Injectable()
export class MetaPublishService {
  private readonly logger = new Logger(MetaPublishService.name);

  constructor(
    @InjectRepository(MetaCampaignDraft)
    private readonly draftRepository: Repository<MetaCampaignDraft>,
    @InjectRepository(FacebookCampaign)
    private readonly facebookCampaignRepository: Repository<FacebookCampaign>,
    @InjectRepository(MetaCampaignError)
    private readonly metaCampaignErrorRepository: Repository<MetaCampaignError>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    private readonly metaTokenService: FacebookMetaTokenService,
    private readonly auditService: FacebookIntegrationAuditService,
  ) {}

  async publishFullCampaign(
    user: User,
    restaurantId: number,
    draftId: string,
  ): Promise<PublishMetaCampaignResponseDto> {
    requireAdminRole(
      user,
      'You do not have permission to publish Facebook campaigns.',
    );

    const restaurant = await this.loadOwnedRestaurant(user, restaurantId);

    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        restaurantId,
        userId: user.id,
      },
    });

    if (!draft) {
      throw new NotFoundException('Campaign draft not found.');
    }

    if (!draft.campaignData || !draft.adSetData || !draft.adCreativeData) {
      throw new BadRequestException(
        'Complete all builder steps (Campaign, Ad Set, Ad / Creative) before publishing.',
      );
    }

    if (draft.status === 'published' && draft.metaAdId) {
      throw new BadRequestException(
        'This draft was already published. Create a new campaign to publish again.',
      );
    }

    await this.recoverStalePublishingDraft(draft);

    const lockResult = await this.draftRepository.update(
      {
        id: draft.id,
        restaurantId,
        userId: user.id,
        status: In(['draft', 'failed']),
      },
      {
        status: 'publishing',
        errorMessage: null,
      },
    );

    if (!lockResult.affected) {
      throw new BadRequestException(
        'This campaign cannot be published right now. It may already be publishing or published.',
      );
    }

    const campaign = draft.campaignData as CampaignStepDataDto;
    const adSet = draft.adSetData as AdSetStepDataDto;
    const creative = draft.adCreativeData as AdCreativeStepDataDto;

    assertAdCreativeMedia(creative as never);
    assertInstagramActorIfNeeded(adSet.placements, creative.instagramActorId);

    const { accessToken, adAccountId: storedAdAccountId } =
      await this.metaTokenService.assertRestaurantMetaCredentials(restaurant);

    const adAccountId = normalizeAdAccountId(storedAdAccountId ?? '');
    this.logger.log(
      `Publish started: metaUserId=${restaurant.metaUserId} adAccountId=${adAccountId} draft=${draft.id}`,
    );

    await this.ensureAdAccountActive(adAccountId, accessToken);
    await this.assertPageAccessible(creative.facebookPageId, accessToken);

    const ctx: PublishContext = {
      accessToken,
      adAccountId,
      campaign,
      adSet,
      creative,
    };

    let metaCampaignId: string | null = draft.metaCampaignId;
    let metaAdsetId: string | null = draft.metaAdsetId;
    let metaCreativeId: string | null = draft.metaCreativeId;

    const tracking = await this.findOrCreateTrackingRow(
      user.id,
      restaurantId,
      adAccountId,
      campaign,
      adSet,
      creative,
      draft,
    );

    try {
      if (!metaCampaignId) {
        logMetaPublishStep('campaign', 'start', {
          adAccountId: ctx.adAccountId,
          campaignName: ctx.campaign.name,
        });
        metaCampaignId = await this.createCampaign(ctx);
        this.logger.log(`Meta campaign created: ${metaCampaignId}`);
        await this.updatePartialState(draft.id, tracking.id, {
          metaCampaignId,
        });
      }

      if (!metaAdsetId) {
        logMetaPublishStep('adset', 'start', { metaCampaignId });
        metaAdsetId = await this.createAdSet(ctx, metaCampaignId);
        this.logger.log(`Meta ad set created: ${metaAdsetId}`);
        await this.updatePartialState(draft.id, tracking.id, {
          metaCampaignId,
          metaAdsetId,
        });
      }

      let metaAdId: string | null = draft.metaAdId;

      if (!metaCreativeId) {
        logMetaPublishStep('media', 'start', {
          format: ctx.creative.creativeFormat,
        });
        const mediaRefs = await this.uploadCreativeMedia(ctx);

        logMetaPublishStep('creative', 'start', { mediaRefs });
        metaCreativeId = await this.createCreative(ctx, mediaRefs);
        this.logger.log(`Meta creative created: ${metaCreativeId}`);
        await this.updatePartialState(draft.id, tracking.id, {
          metaCampaignId,
          metaAdsetId,
          metaCreativeId,
        });
      }

      if (!metaAdId) {
        logMetaPublishStep('ad', 'start', { metaAdsetId, metaCreativeId });
        metaAdId = await this.createAd(ctx, metaAdsetId, metaCreativeId);
        this.logger.log(`Meta ad created: ${metaAdId}`);
      }

      if (!metaCampaignId || !metaAdsetId || !metaCreativeId || !metaAdId) {
        throw new BadRequestException(
          'Publish incomplete — Meta ad id was not created.',
        );
      }

      await this.facebookCampaignRepository.update(tracking.id, {
        metaCampaignId,
        metaAdsetId,
        metaCreativeId,
        metaAdId,
        status: 'PAUSED',
        errorMessage: null,
      });

      await this.draftRepository.update(draft.id, {
        metaCampaignId,
        metaAdsetId,
        metaCreativeId,
        metaAdId,
        status: 'published',
        errorMessage: null,
        currentStep: 4,
      });

      await this.auditService.log(restaurantId, 'meta_campaign_published', {
        metadata: {
          draftId: draft.id,
          metaCampaignId,
          metaAdsetId,
          metaCreativeId,
          metaAdId,
        },
      });

      this.logger.log(
        `Draft ${draft.id} published for restaurant ${restaurantId}: ad=${metaAdId}`,
      );

      return {
        draftId: draft.id,
        trackingId: tracking.id,
        metaCampaignId,
        metaAdsetId,
        metaCreativeId,
        metaAdId,
        status: 'PAUSED',
        adsManagerUrl: adsManagerCampaignsUrl(adAccountId),
        message: 'Campaign published successfully to Meta (paused).',
      };
    } catch (err) {
      throw await this.handlePublishFailure(
        user.id,
        restaurantId,
        draft.id,
        tracking.id,
        err,
        { metaCampaignId, metaAdsetId, metaCreativeId },
      );
    }
  }

  async createCampaign(ctx: PublishContext): Promise<string> {
    this.logger.log('Publishing step: campaign');
    const result = await graphPostWithToken<{ id: string }>(
      `/${ctx.adAccountId}/campaigns`,
      ctx.accessToken,
      buildCampaignPayloadFromDraft(ctx.campaign),
      'campaign',
    );
    return result.id;
  }

  async createAdSet(
    ctx: PublishContext,
    metaCampaignId: string,
  ): Promise<string> {
    this.logger.log('Publishing step: adset');
    const result = await graphPostWithToken<{ id: string }>(
      `/${ctx.adAccountId}/adsets`,
      ctx.accessToken,
      buildAdSetPayloadFromDraft(ctx.campaign, ctx.adSet, metaCampaignId),
      'adset',
    );
    return result.id;
  }

  async uploadImage(
    adAccountId: string,
    accessToken: string,
    imageUrl: string,
  ): Promise<string> {
    const trimmed = imageUrl.trim();
    const forMeta = toAbsoluteAssetUrlIfRelative(trimmed) ?? trimmed;
    return uploadAdImageHash(adAccountId, accessToken, forMeta);
  }

  async uploadVideo(
    adAccountId: string,
    accessToken: string,
    videoUrl: string,
  ): Promise<string> {
    const resolved =
      toAbsoluteAssetUrlIfRelative(videoUrl.trim()) ?? videoUrl.trim();
    assertDirectMetaVideoUrl(resolved);
    return uploadAdVideoId(adAccountId, accessToken, resolved);
  }

  private async uploadCreativeMedia(ctx: PublishContext): Promise<{
    imageHash?: string;
    videoId?: string;
    carouselHashes?: string[];
  }> {
    this.logger.log('Publishing step: media');
    const { creative, adAccountId, accessToken } = ctx;

    switch (creative.creativeFormat) {
      case MetaCreativeFormat.SINGLE_IMAGE: {
        const imageHash = await this.uploadImage(
          adAccountId,
          accessToken,
          creative.imageUrl!,
        );
        return { imageHash };
      }
      case MetaCreativeFormat.SINGLE_VIDEO: {
        const videoId = await this.uploadVideo(
          adAccountId,
          accessToken,
          creative.videoUrl!,
        );
        return { videoId };
      }
      case MetaCreativeFormat.CAROUSEL: {
        const carouselHashes: string[] = [];
        for (const card of creative.carouselCards ?? []) {
          if (card.imageUrl?.trim()) {
            carouselHashes.push(
              await this.uploadImage(adAccountId, accessToken, card.imageUrl),
            );
          } else if (card.videoUrl?.trim()) {
            throw new BadRequestException(
              'Carousel video cards are not supported yet. Use images for each card.',
            );
          }
        }
        return { carouselHashes };
      }
      default:
        throw new BadRequestException('Unsupported creative format.');
    }
  }

  async createCreative(
    ctx: PublishContext,
    media: {
      imageHash?: string;
      videoId?: string;
      carouselHashes?: string[];
    },
  ): Promise<string> {
    this.logger.log('Publishing step: creative');
    const destinationUrl = buildDestinationUrlWithParams(
      ctx.creative.destinationUrl ?? '',
      ctx.creative.urlParameters,
    );

    if (
      !destinationUrl.trim() &&
      ctx.creative.creativeFormat !== MetaCreativeFormat.CAROUSEL
    ) {
      throw new BadRequestException('Landing page URL is required.');
    }

    const result = await graphPostWithToken<{ id: string }>(
      `/${ctx.adAccountId}/adcreatives`,
      ctx.accessToken,
      buildCreativePayloadFromDraft(ctx.creative, media, destinationUrl),
      'creative',
    );
    return result.id;
  }

  async createAd(
    ctx: PublishContext,
    metaAdsetId: string,
    metaCreativeId: string,
  ): Promise<string> {
    this.logger.log('Publishing step: ad');
    const result = await graphPostWithToken<{ id: string }>(
      `/${ctx.adAccountId}/ads`,
      ctx.accessToken,
      buildAdPayloadFromDraft(ctx.creative, metaAdsetId, metaCreativeId),
      'ad',
    );
    return result.id;
  }

  private async findOrCreateTrackingRow(
    userId: number,
    restaurantId: number,
    adAccountId: string,
    campaign: CampaignStepDataDto,
    adSet: AdSetStepDataDto,
    creative: AdCreativeStepDataDto,
    draft: MetaCampaignDraft,
  ): Promise<FacebookCampaign> {
    if (draft.metaCampaignId) {
      const [existing] = await this.facebookCampaignRepository.find({
        where: {
          restaurantId,
          metaCampaignId: draft.metaCampaignId,
        },
        order: { createdAt: 'DESC' },
        take: 1,
      });

      if (existing) {
        await this.facebookCampaignRepository.update(existing.id, {
          status: 'PENDING',
          errorMessage: null,
        });
        return existing;
      }
    }

    return this.facebookCampaignRepository.save({
      userId,
      restaurantId,
      adAccountId,
      campaignName: campaign.name,
      objective: campaign.objective,
      budget: String(adSet.dailyBudget ?? adSet.lifetimeBudget ?? 0),
      startTime: new Date(adSet.startDate),
      endTime: new Date(adSet.endDate),
      facebookPageId: creative.facebookPageId,
      instagramActorId: creative.instagramActorId?.trim() || null,
      status: 'PENDING',
      errorMessage: null,
      metaCampaignId: draft.metaCampaignId,
      metaAdsetId: draft.metaAdsetId,
      metaCreativeId: draft.metaCreativeId,
    });
  }

  private async updatePartialState(
    draftId: string,
    trackingId: string,
    partial: {
      metaCampaignId?: string | null;
      metaAdsetId?: string | null;
      metaCreativeId?: string | null;
      metaAdId?: string | null;
    },
  ): Promise<void> {
    if (partial.metaCampaignId) {
      await this.facebookCampaignRepository.update(trackingId, {
        metaCampaignId: partial.metaCampaignId,
      });
    }
    if (partial.metaAdsetId) {
      await this.facebookCampaignRepository.update(trackingId, {
        metaAdsetId: partial.metaAdsetId,
      });
    }
    if (partial.metaCreativeId) {
      await this.facebookCampaignRepository.update(trackingId, {
        metaCreativeId: partial.metaCreativeId,
      });
    }
    await this.draftRepository.update(draftId, {
      metaCampaignId: partial.metaCampaignId ?? undefined,
      metaAdsetId: partial.metaAdsetId ?? undefined,
      metaCreativeId: partial.metaCreativeId ?? undefined,
      metaAdId: partial.metaAdId ?? undefined,
    });
  }

  private async handlePublishFailure(
    userId: number,
    restaurantId: number,
    draftId: string,
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

    await this.draftRepository.update(draftId, {
      metaCampaignId: partial.metaCampaignId,
      metaAdsetId: partial.metaAdsetId,
      metaCreativeId: partial.metaCreativeId,
      status: 'failed',
      errorMessage: userMessage,
    });

    await this.metaCampaignErrorRepository.save({
      userId,
      restaurantId,
      facebookCampaignId: trackingId,
      step,
      metaErrorCode,
      metaErrorMessage,
      rawResponse,
    });

    await this.auditService.log(restaurantId, 'meta_campaign_publish_failed', {
      errorMessage: userMessage,
      metadata: { draftId, step, metaErrorCode },
    });

    this.logger.error(
      `Draft publish failed at step=${step} for restaurant ${restaurantId}: code=${metaErrorCode} message=${metaErrorMessage} partialIds=${JSON.stringify(partial)}`,
    );

    throw new BadRequestException(userMessage);
  }

  private async recoverStalePublishingDraft(
    draft: MetaCampaignDraft,
  ): Promise<void> {
    if (draft.status !== 'publishing') {
      return;
    }

    const updatedAt = draft.updatedAt?.getTime?.() ?? 0;
    const staleMs = 15 * 60 * 1000;
    if (Date.now() - updatedAt < staleMs) {
      throw new BadRequestException(
        'Publish is already in progress. Wait a few minutes and try again.',
      );
    }

    await this.draftRepository.update(draft.id, {
      status: 'failed',
      errorMessage:
        'Previous publish timed out. Retry to continue from saved Meta IDs.',
    });
    draft.status = 'failed';
  }

  private async loadOwnedRestaurant(
    user: User,
    restaurantId: number,
  ): Promise<Restaurant> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: user.id } },
    });

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    return restaurant;
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
      (row) => row.id?.trim() === pageId.trim(),
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
