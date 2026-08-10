import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { MetaCampaignError } from '../../db/entities/meta-campaign-error.entity';
import { MetaPublishAttempt } from '../../db/entities/meta-publish-attempt.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import { FacebookIntegrationAuditService } from '../facebook/facebook-integration-audit.service';
import { FacebookMetaTokenService } from '../facebook/facebook-meta-token.service';
import { FacebookService } from '../facebook/facebook.service';
import { AdCreativeStepDataDto } from './dto/ad-creative-step-data.dto';
import { AdSetStepDataDto } from './dto/adset-step-data.dto';
import { CampaignStepDataDto } from './dto/meta-campaign-draft-response.dto';
import { EnqueueMetaPublishResponseDto } from './dto/enqueue-meta-publish-response.dto';
import {
  MetaPublishAttemptDto,
  MetaPublishStatusDto,
} from './dto/meta-publish-status.dto';
import {
  adsManagerCampaignsUrl,
  MetaApiStepError,
  normalizeAdAccountId,
  stepFailureUserMessage,
} from './facebook-campaign-meta';
import {
  assertAdCreativeMedia,
  buildDestinationUrlWithParams,
} from './meta-ad-creative-draft-validation';
import {
  sdkCreateAd,
  sdkCreateAdCreative,
  sdkCreateAdSet,
  sdkCreateCampaign,
} from './meta-business-sdk';
import { MetaCreativeFormat, MetaCreationStep } from './meta-campaign.constants';
import {
  buildAdPayloadFromDraft,
  buildAdSetPayloadFromDraft,
  buildCampaignPayloadFromDraft,
  buildCreativePayloadFromDraft,
} from './meta-draft-payload-builders';
import { isTransientMetaPublishError } from './meta-publish-errors.util';
import {
  META_PUBLISH_QUEUE,
  MetaPublishJobName,
  metaPublishJobId,
  metaPublishProgressPercent,
  type MetaPublishJobPayload,
} from './meta-publish-queue.constants';
import { MetaAdsService } from './meta-ads.service';
import { MetaPublishRealtimeService } from './meta-publish-realtime.service';
import { logMetaPublishStep } from './meta-publish-trace';

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
    @InjectRepository(MetaPublishAttempt)
    private readonly attemptRepository: Repository<MetaPublishAttempt>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectQueue(META_PUBLISH_QUEUE)
    private readonly metaPublishQueue: Queue<MetaPublishJobPayload>,
    private readonly dataSource: DataSource,
    private readonly businessAccessService: BusinessAccessService,
    private readonly metaTokenService: FacebookMetaTokenService,
    private readonly auditService: FacebookIntegrationAuditService,
    private readonly facebookService: FacebookService,
    private readonly metaAdsService: MetaAdsService,
    private readonly realtimeService: MetaPublishRealtimeService,
  ) {}

  
  async publishFullCampaign(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<EnqueueMetaPublishResponseDto> {
    return this.enqueuePublish(user, businessId, draftId);
  }

  async enqueuePublish(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<EnqueueMetaPublishResponseDto> {
    await this.loadOwnedBusiness(user, businessId);

    const jobId = metaPublishJobId(businessId, draftId.trim());

    const result = await this.dataSource.transaction(async (manager) => {
      const draftRepo = manager.getRepository(MetaCampaignDraft);

      const draft = await draftRepo
        .createQueryBuilder('draft')
        .where('draft.id = :id', { id: draftId.trim() })
        .andWhere('draft.businessId = :businessId', { businessId })
        .andWhere('draft.userId = :userId', { userId: user.id })
        .setLock('pessimistic_write')
        .getOne();

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

      await this.recoverStalePublishingDraftInTx(draftRepo, draft);

      
      if (draft.status === 'publishing' && draft.publishJobId) {
        const existingJob = await this.metaPublishQueue.getJob(
          draft.publishJobId,
        );
        if (existingJob) {
          const state = await existingJob.getState();
          if (
            state === 'waiting' ||
            state === 'active' ||
            state === 'delayed' ||
            state === 'prioritized'
          ) {
            return {
              alreadyQueued: true as const,
              response: {
                status: 'publishing' as const,
                draftId: draft.id,
                jobId: draft.publishJobId,
                publishStatus: 'QUEUED' as const,
                message:
                  'Publish is already in progress for this campaign draft.',
              },
            };
          }
        }

        
        draft.status = 'failed';
        draft.publishStatus = 'FAILED';
        draft.errorMessage =
          draft.errorMessage ??
          'Previous publish did not finish. Retry to continue from saved Meta IDs.';
      }

      if (draft.status !== 'draft' && draft.status !== 'failed') {
        throw new BadRequestException(
          'This campaign cannot be published right now. It may already be publishing or published.',
        );
      }

      draft.status = 'publishing';
      draft.publishStatus = 'QUEUED';
      draft.publishJobId = jobId;
      draft.publishStep = 'queued';
      draft.publishProgress = metaPublishProgressPercent('queued');
      draft.errorMessage = null;
      await draftRepo.save(draft);

      return {
        alreadyQueued: false as const,
        draft,
        response: {
          status: 'publishing' as const,
          draftId: draft.id,
          jobId,
          publishStatus: 'QUEUED' as const,
          message:
            'Campaign publish queued. Track progress via publish-status.',
        },
      };
    });

    if (result.alreadyQueued) {
      return result.response;
    }

    const { draft, response } = result;

    
    const prior = await this.metaPublishQueue.getJob(jobId);
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
        await this.notifyDraftProgress(draft);
        return {
          status: 'publishing',
          draftId: draft.id,
          jobId,
          publishStatus: 'QUEUED',
          message: 'Publish is already in progress for this campaign draft.',
        };
      }
    }

    await this.metaPublishQueue.add(
      MetaPublishJobName.PUBLISH_DRAFT,
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

    await this.recordAttempt({
      draftId: draft.id,
      businessId,
      userId: user.id,
      jobId,
      step: 'queued',
      status: 'success',
      metaId: null,
      errorMessage: null,
      complete: true,
    });

    await this.notifyDraftProgress(draft);

    return response;
  }

  async processQueuedPublish(
    job: Job<MetaPublishJobPayload>,
  ): Promise<void> {
    const { userId, businessId, draftId } = job.data;
    const jobId = String(job.id ?? metaPublishJobId(businessId, draftId));

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new UnrecoverableError(`Business ${businessId} not found.`);
    }

    const draft = await this.draftRepository.findOne({
      where: { id: draftId, businessId, userId },
    });
    if (!draft) {
      throw new UnrecoverableError(`Draft ${draftId} not found.`);
    }

    if (draft.status === 'published' && draft.metaAdId) {
      this.logger.log(`Draft ${draftId} already published; skipping job.`);
      return;
    }

    draft.status = 'publishing';
    draft.publishStatus = 'PUBLISHING';
    draft.publishJobId = jobId;
    draft.publishStep = 'queued';
    draft.publishProgress = metaPublishProgressPercent('queued');
    draft.errorMessage = null;
    await this.draftRepository.save(draft);
    await this.notifyDraftProgress(draft);

    try {
      await this.runPublishPipeline(userId, business, draft, jobId);
    } catch (err) {
      
      if (!isTransientMetaPublishError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        throw new UnrecoverableError(message);
      }
      throw err;
    }
  }

  async getPublishStatus(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<MetaPublishStatusDto> {
    await this.loadOwnedBusiness(user, businessId);

    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        businessId,
        userId: user.id,
      },
    });

    if (!draft) {
      throw new NotFoundException('Campaign draft not found.');
    }

    const attempts = await this.attemptRepository.find({
      where: { draftId: draft.id },
      order: { startedAt: 'ASC' },
    });

    return {
      draftId: draft.id,
      status: draft.status,
      publishStatus: draft.publishStatus,
      publishStep: draft.publishStep,
      publishProgress: draft.publishProgress ?? 0,
      jobId: draft.publishJobId,
      metaCampaignId: draft.metaCampaignId,
      metaAdsetId: draft.metaAdsetId,
      metaCreativeId: draft.metaCreativeId,
      metaAdId: draft.metaAdId,
      errorMessage: draft.errorMessage,
      publishedAt: draft.publishedAt,
      attempts: attempts.map(
        (row): MetaPublishAttemptDto => ({
          id: row.id,
          step: row.step,
          status: row.status,
          metaId: row.metaId,
          errorMessage: row.errorMessage,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
        }),
      ),
    };
  }

  private async runPublishPipeline(
    userId: number,
    business: Business,
    draft: MetaCampaignDraft,
    jobId: string | null,
  ): Promise<void> {
    const businessId = business.id;
    const campaign = draft.campaignData as CampaignStepDataDto;
    const adSet = draft.adSetData as AdSetStepDataDto;
    const creative = draft.adCreativeData as AdCreativeStepDataDto;

    assertAdCreativeMedia(creative as never);

    const { accessToken, adAccountId: storedAdAccountId } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);

    const adAccountId = normalizeAdAccountId(storedAdAccountId ?? '');
    this.logger.log(
      `Publish started: metaUserId=${business.metaUserId} adAccountId=${adAccountId} draft=${draft.id}`,
    );

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
    let metaAdId: string | null = draft.metaAdId;

    const tracking = await this.findOrCreateTrackingRow(
      userId,
      businessId,
      adAccountId,
      campaign,
      adSet,
      creative,
      draft,
    );

    try {
      if (!metaCampaignId) {
        await this.beginStep(draft, jobId, 'campaign', userId, businessId);
        logMetaPublishStep('campaign', 'start', {
          adAccountId: ctx.adAccountId,
          campaignName: ctx.campaign.name,
        });
        metaCampaignId = await this.createCampaign(ctx);
        this.logger.log(`Meta campaign created: ${metaCampaignId}`);
        await this.updatePartialState(draft.id, tracking.id, {
          metaCampaignId,
        });
        draft.metaCampaignId = metaCampaignId;
        await this.completeStep(draft, jobId, 'campaign', metaCampaignId);
      }

      if (!metaAdsetId) {
        await this.beginStep(draft, jobId, 'adset', userId, businessId);
        logMetaPublishStep('adset', 'start', { metaCampaignId });
        metaAdsetId = await this.createAdSet(ctx, metaCampaignId!);
        this.logger.log(`Meta ad set created: ${metaAdsetId}`);
        await this.updatePartialState(draft.id, tracking.id, {
          metaCampaignId,
          metaAdsetId,
        });
        draft.metaAdsetId = metaAdsetId;
        await this.completeStep(draft, jobId, 'adset', metaAdsetId);
      }

      if (!metaCreativeId) {
        await this.beginStep(draft, jobId, 'media', userId, businessId);
        logMetaPublishStep('media', 'start', {
          format: ctx.creative.creativeFormat,
        });
        const mediaRefs = await this.uploadCreativeMedia(ctx);
        await this.completeStep(draft, jobId, 'media', null);

        await this.beginStep(draft, jobId, 'creative', userId, businessId);
        logMetaPublishStep('creative', 'start', { mediaRefs });
        metaCreativeId = await this.createCreative(ctx, mediaRefs);
        this.logger.log(`Meta creative created: ${metaCreativeId}`);
        await this.updatePartialState(draft.id, tracking.id, {
          metaCampaignId,
          metaAdsetId,
          metaCreativeId,
        });
        draft.metaCreativeId = metaCreativeId;
        await this.completeStep(draft, jobId, 'creative', metaCreativeId);
      }

      if (!metaAdId) {
        await this.beginStep(draft, jobId, 'ad', userId, businessId);
        logMetaPublishStep('ad', 'start', { metaAdsetId, metaCreativeId });
        metaAdId = await this.createAd(ctx, metaAdsetId!, metaCreativeId!);
        this.logger.log(`Meta ad created: ${metaAdId}`);
        await this.updatePartialState(draft.id, tracking.id, {
          metaCampaignId,
          metaAdsetId,
          metaCreativeId,
          metaAdId,
        });
        draft.metaAdId = metaAdId;
        await this.completeStep(draft, jobId, 'ad', metaAdId);
      }

      if (!metaCampaignId || !metaAdsetId || !metaCreativeId || !metaAdId) {
        throw new BadRequestException(
          'Publish incomplete — Meta ad id was not created.',
        );
      }

      const deliveryStatus = campaign.status ?? 'PAUSED';

      await this.facebookCampaignRepository.update(tracking.id, {
        metaCampaignId,
        metaAdsetId,
        metaCreativeId,
        metaAdId,
        status: deliveryStatus,
        errorMessage: null,
      });

      const publishedAt = new Date();
      await this.draftRepository.update(draft.id, {
        metaCampaignId,
        metaAdsetId,
        metaCreativeId,
        metaAdId,
        status: 'published',
        publishStatus: 'PUBLISHED',
        publishStep: 'done',
        publishProgress: 100,
        publishedAt,
        errorMessage: null,
        currentStep: 4,
      });

      draft.status = 'published';
      draft.publishStatus = 'PUBLISHED';
      draft.publishStep = 'done';
      draft.publishProgress = 100;
      draft.publishedAt = publishedAt;
      draft.metaCampaignId = metaCampaignId;
      draft.metaAdsetId = metaAdsetId;
      draft.metaCreativeId = metaCreativeId;
      draft.metaAdId = metaAdId;
      draft.errorMessage = null;

      await this.recordAttempt({
        draftId: draft.id,
        businessId,
        userId,
        jobId,
        step: 'done',
        status: 'success',
        metaId: metaAdId,
        errorMessage: null,
        complete: true,
      });

      await this.auditService.log(businessId, 'meta_campaign_published', {
        metadata: {
          draftId: draft.id,
          metaCampaignId,
          metaAdsetId,
          metaCreativeId,
          metaAdId,
          jobId,
        },
      });

      this.facebookService.invalidateCampaignStatsCache(businessId);
      await this.notifyDraftProgress(draft);

      this.logger.log(
        `Draft ${draft.id} published for business ${businessId}: ad=${metaAdId} adsManager=${adsManagerCampaignsUrl(adAccountId)}`,
      );
    } catch (err) {
      throw await this.handlePublishFailure(
        userId,
        businessId,
        draft.id,
        tracking.id,
        jobId,
        err,
        { metaCampaignId, metaAdsetId, metaCreativeId, metaAdId },
      );
    }
  }

  async createCampaign(ctx: PublishContext): Promise<string> {
    this.logger.log('Publishing step: campaign');
    return sdkCreateCampaign(
      ctx.accessToken,
      ctx.adAccountId,
      buildCampaignPayloadFromDraft(ctx.campaign),
    );
  }

  async createAdSet(
    ctx: PublishContext,
    metaCampaignId: string,
  ): Promise<string> {
    this.logger.log('Publishing step: adset');
    return sdkCreateAdSet(
      ctx.accessToken,
      ctx.adAccountId,
      await buildAdSetPayloadFromDraft(
        ctx.campaign,
        ctx.adSet,
        metaCampaignId,
        ctx.accessToken,
      ),
    );
  }

  async uploadImage(
    adAccountId: string,
    accessToken: string,
    imageUrl: string,
  ): Promise<string> {
    const result = await this.metaAdsService.uploadImageToMeta({
      adAccountId,
      accessToken,
      storageUrl: this.metaAdsService.assertMediaExists(imageUrl, 'image'),
    });
    return result.imageHash;
  }

  async uploadVideo(
    adAccountId: string,
    accessToken: string,
    videoUrl: string,
  ): Promise<string> {
    const result = await this.metaAdsService.uploadVideoToMeta({
      adAccountId,
      accessToken,
      storageUrl: this.metaAdsService.assertMediaExists(videoUrl, 'video'),
    });
    return result.videoId;
  }

  private async uploadCreativeMedia(ctx: PublishContext): Promise<{
    imageHash?: string;
    videoId?: string;
    videoThumbnailHash?: string;
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

        let videoThumbnailHash: string | undefined;
        const thumbnailUrl = creative.thumbnailUrl?.trim();
        if (thumbnailUrl) {
          videoThumbnailHash = await this.uploadImage(
            adAccountId,
            accessToken,
            thumbnailUrl,
          );
        }

        return { videoId, videoThumbnailHash };
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
      videoThumbnailHash?: string;
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

    const payload = buildCreativePayloadFromDraft(
      ctx.creative,
      media,
      destinationUrl,
    );

    if (media.videoId) {
      const storySpec =
        payload.object_story_spec &&
        typeof payload.object_story_spec === 'object'
          ? (payload.object_story_spec as Record<string, unknown>)
          : {};
      const videoData: Record<string, unknown> =
        storySpec.video_data && typeof storySpec.video_data === 'object'
          ? { ...(storySpec.video_data as Record<string, unknown>) }
          : { video_id: media.videoId };

      const thumbnailHash = media.videoThumbnailHash?.trim();
      const thumbnailUrl = ctx.creative.thumbnailUrl?.trim();
      if (thumbnailHash) {
        videoData.image_hash = thumbnailHash;
        delete videoData.image_url;
      } else if (thumbnailUrl) {
        videoData.image_url = thumbnailUrl;
      } else {
        throw new BadRequestException(
          'Video ads require a thumbnail image. Upload a thumbnail on the Creative step, then publish again.',
        );
      }

      if (!videoData.image_hash && !videoData.image_url) {
        throw new BadRequestException(
          'Video ads require image_hash or image_url on video_data. Upload a thumbnail and publish again.',
        );
      }

      payload.object_story_spec = {
        ...storySpec,
        video_data: videoData,
      };

      this.logger.log(
        `Creative video_data thumbnail keys: hash=${Boolean(videoData.image_hash)} url=${Boolean(videoData.image_url)}`,
      );
    }

    return sdkCreateAdCreative(
      ctx.accessToken,
      ctx.adAccountId,
      payload,
    );
  }

  async createAd(
    ctx: PublishContext,
    metaAdsetId: string,
    metaCreativeId: string,
  ): Promise<string> {
    this.logger.log('Publishing step: ad');
    return sdkCreateAd(
      ctx.accessToken,
      ctx.adAccountId,
      buildAdPayloadFromDraft(ctx.creative, metaAdsetId, metaCreativeId),
    );
  }

  private async beginStep(
    draft: MetaCampaignDraft,
    jobId: string | null,
    step: string,
    userId: number,
    businessId: number,
  ): Promise<void> {
    draft.publishStep = step;
    draft.publishProgress = metaPublishProgressPercent(step);
    draft.publishStatus = 'PUBLISHING';
    await this.draftRepository.update(draft.id, {
      publishStep: step,
      publishProgress: draft.publishProgress,
      publishStatus: 'PUBLISHING',
      status: 'publishing',
    });

    await this.recordAttempt({
      draftId: draft.id,
      businessId,
      userId,
      jobId,
      step,
      status: 'running',
      metaId: null,
      errorMessage: null,
      complete: false,
    });

    await this.notifyDraftProgress(draft);
  }

  private async completeStep(
    draft: MetaCampaignDraft,
    jobId: string | null,
    step: string,
    metaId: string | null,
  ): Promise<void> {
    await this.attemptRepository.update(
      {
        draftId: draft.id,
        step,
        status: 'running',
        ...(jobId ? { jobId } : {}),
      },
      {
        status: 'success',
        metaId,
        completedAt: new Date(),
        errorMessage: null,
      },
    );
  }

  private async recordAttempt(params: {
    draftId: string;
    businessId: number;
    userId: number;
    jobId: string | null;
    step: string;
    status: string;
    metaId: string | null;
    errorMessage: string | null;
    complete: boolean;
  }): Promise<void> {
    await this.attemptRepository.save({
      draftId: params.draftId,
      businessId: params.businessId,
      userId: params.userId,
      jobId: params.jobId,
      step: params.step,
      status: params.status,
      metaId: params.metaId,
      errorMessage: params.errorMessage,
      startedAt: new Date(),
      completedAt: params.complete ? new Date() : null,
    });
  }

  private async notifyDraftProgress(draft: MetaCampaignDraft): Promise<void> {
    await this.realtimeService.notifyProgress({
      businessId: draft.businessId,
      draftId: draft.id,
      status: draft.status,
      publishStatus: draft.publishStatus,
      publishStep: draft.publishStep,
      publishProgress: draft.publishProgress ?? 0,
      jobId: draft.publishJobId,
      metaCampaignId: draft.metaCampaignId,
      metaAdsetId: draft.metaAdsetId,
      metaCreativeId: draft.metaCreativeId,
      metaAdId: draft.metaAdId,
      errorMessage: draft.errorMessage,
    });
  }

  private async findOrCreateTrackingRow(
    userId: number,
    businessId: number,
    adAccountId: string,
    campaign: CampaignStepDataDto,
    adSet: AdSetStepDataDto,
    creative: AdCreativeStepDataDto,
    draft: MetaCampaignDraft,
  ): Promise<FacebookCampaign> {
    const byDraft = await this.facebookCampaignRepository.findOne({
      where: { businessId, draftId: draft.id },
    });
    if (byDraft) {
      await this.facebookCampaignRepository.update(byDraft.id, {
        status: 'PENDING',
        errorMessage: null,
        campaignName: campaign.name,
        objective: campaign.objective,
        budget: String(adSet.dailyBudget ?? adSet.lifetimeBudget ?? 0),
        startTime: new Date(adSet.startDate),
        endTime: adSet.endDate ? new Date(adSet.endDate) : null,
        facebookPageId: creative.facebookPageId,
        instagramActorId: creative.instagramActorId?.trim() || null,
        metaCampaignId: draft.metaCampaignId ?? byDraft.metaCampaignId,
        metaAdsetId: draft.metaAdsetId ?? byDraft.metaAdsetId,
        metaCreativeId: draft.metaCreativeId ?? byDraft.metaCreativeId,
        metaAdId: draft.metaAdId ?? byDraft.metaAdId,
      });
      const refreshed = await this.facebookCampaignRepository.findOne({
        where: { id: byDraft.id },
      });
      if (refreshed) return refreshed;
      return byDraft;
    }

    if (draft.metaCampaignId) {
      const [existing] = await this.facebookCampaignRepository.find({
        where: {
          businessId,
          metaCampaignId: draft.metaCampaignId,
        },
        order: { createdAt: 'DESC' },
        take: 1,
      });

      if (existing) {
        await this.facebookCampaignRepository.update(existing.id, {
          draftId: draft.id,
          status: 'PENDING',
          errorMessage: null,
        });
        return existing;
      }
    }

    return this.facebookCampaignRepository.save({
      userId,
      businessId,
      draftId: draft.id,
      adAccountId,
      campaignName: campaign.name,
      objective: campaign.objective,
      budget: String(adSet.dailyBudget ?? adSet.lifetimeBudget ?? 0),
      startTime: new Date(adSet.startDate),
      endTime: adSet.endDate ? new Date(adSet.endDate) : null,
      facebookPageId: creative.facebookPageId,
      instagramActorId: creative.instagramActorId?.trim() || null,
      status: 'PENDING',
      errorMessage: null,
      metaCampaignId: draft.metaCampaignId,
      metaAdsetId: draft.metaAdsetId,
      metaCreativeId: draft.metaCreativeId,
      metaAdId: draft.metaAdId,
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
    const trackingUpdate: Partial<FacebookCampaign> = {};
    if (partial.metaCampaignId) {
      trackingUpdate.metaCampaignId = partial.metaCampaignId;
    }
    if (partial.metaAdsetId) {
      trackingUpdate.metaAdsetId = partial.metaAdsetId;
    }
    if (partial.metaCreativeId) {
      trackingUpdate.metaCreativeId = partial.metaCreativeId;
    }
    if (partial.metaAdId) {
      trackingUpdate.metaAdId = partial.metaAdId;
    }
    if (Object.keys(trackingUpdate).length > 0) {
      await this.facebookCampaignRepository.update(trackingId, trackingUpdate);
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
    businessId: number,
    draftId: string,
    trackingId: string,
    jobId: string | null,
    err: unknown,
    partial: {
      metaCampaignId: string | null;
      metaAdsetId: string | null;
      metaCreativeId: string | null;
      metaAdId: string | null;
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
      metaAdId: partial.metaAdId,
      status: 'FAILED',
      errorMessage: userMessage,
    });

    await this.draftRepository.update(draftId, {
      metaCampaignId: partial.metaCampaignId,
      metaAdsetId: partial.metaAdsetId,
      metaCreativeId: partial.metaCreativeId,
      metaAdId: partial.metaAdId,
      status: 'failed',
      publishStatus: 'FAILED',
      errorMessage: userMessage,
    });

    await this.attemptRepository.update(
      {
        draftId,
        status: 'running',
      },
      {
        status: 'failed',
        errorMessage: userMessage,
        completedAt: new Date(),
      },
    );

    await this.metaCampaignErrorRepository.save({
      userId,
      businessId,
      facebookCampaignId: trackingId,
      step,
      metaErrorCode,
      metaErrorMessage,
      rawResponse,
    });

    await this.auditService.log(businessId, 'meta_campaign_publish_failed', {
      errorMessage: userMessage,
      metadata: { draftId, step, metaErrorCode, jobId },
    });

    const draft = await this.draftRepository.findOne({
      where: { id: draftId },
    });
    if (draft) {
      await this.notifyDraftProgress(draft);
    }

    this.logger.error(
      `Draft publish failed at step=${step} for business ${businessId}: code=${metaErrorCode} message=${metaErrorMessage} partialIds=${JSON.stringify(partial)}`,
    );

    throw err instanceof Error ? err : new BadRequestException(userMessage);
  }

  private async recoverStalePublishingDraftInTx(
    draftRepo: Repository<MetaCampaignDraft>,
    draft: MetaCampaignDraft,
  ): Promise<void> {
    if (draft.status !== 'publishing') {
      return;
    }

    const updatedAt = draft.updatedAt?.getTime?.() ?? 0;
    const staleMs = 15 * 60 * 1000;
    if (Date.now() - updatedAt < staleMs) {
      return;
    }

    draft.status = 'failed';
    draft.publishStatus = 'FAILED';
    draft.errorMessage =
      'Previous publish timed out. Retry to continue from saved Meta IDs.';
    await draftRepo.save(draft);
  }

  private async loadOwnedBusiness(
    user: User,
    businessId: number,
  ): Promise<Business> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['meta_ads', 'meta_campaigns'],
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

    return business;
  }
}
