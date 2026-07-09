import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import { MetaCampaignError } from '../../db/entities/meta-campaign-error.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  toAbsoluteAssetUrlIfRelative,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { FacebookIntegrationAuditService } from '../facebook/facebook-integration-audit.service';
import { FacebookMetaTokenService } from '../facebook/facebook-meta-token.service';
import { CreateFacebookCampaignDto } from './dto/create-facebook-campaign.dto';
import { CreateFacebookCampaignResponseDto } from './dto/create-facebook-campaign-response.dto';
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
  graphPostWithToken,
  MetaApiStepError,
  normalizeAdAccountId,
  resolveCityTargetingKey,
  stepFailureUserMessage,
  toMetaUnixTime,
  uploadAdImageHash,
  uploadAdVideoId,
} from './facebook-campaign-meta';
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
    @InjectRepository(MetaCampaignError)
    private readonly metaCampaignErrorRepository: Repository<MetaCampaignError>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    private readonly auditService: FacebookIntegrationAuditService,
    private readonly metaTokenService: FacebookMetaTokenService,
    private readonly spacesService: SpacesService,
  ) {}

  async uploadAdImageForRestaurant(
    user: User,
    restaurantId: number,
    file: Express.Multer.File,
  ): Promise<{ imageUrl: string }> {
    requireAdminRole(
      user,
      'You do not have permission to upload Facebook ad images.',
    );

    const restaurant = await this.loadOwnedRestaurant(user, restaurantId);

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
        'PUBLIC_BASE_URL must use HTTPS (set your ngrok URL in .env) so Meta can download the ad image.',
      );
    }

    return { imageUrl };
  }

  async uploadAdVideoForRestaurant(
    user: User,
    restaurantId: number,
    file: Express.Multer.File,
  ): Promise<{ videoUrl: string }> {
    requireAdminRole(
      user,
      'You do not have permission to upload Facebook ad videos.',
    );

    await this.loadOwnedRestaurant(user, restaurantId);

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

    return { videoUrl };
  }

  async createForRestaurant(
    user: User,
    restaurantId: number,
    dto: CreateFacebookCampaignDto,
  ): Promise<CreateFacebookCampaignResponseDto> {
    requireAdminRole(
      user,
      'You do not have permission to create Facebook campaigns.',
    );

    const restaurant = await this.loadOwnedRestaurant(user, restaurantId);

    const { accessToken, adAccountId: storedAdAccountId } =
      await this.metaTokenService.assertRestaurantMetaCredentials(restaurant);

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
      restaurantId,
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
        `Creating Meta campaign for restaurant ${restaurantId} (tracking ${tracking.id})`,
      );
      const campaign = await graphPostWithToken<{ id: string }>(
        `/${adAccountId}/campaigns`,
        accessToken,
        buildCampaignPayload({
          name: dto.name.trim(),
          objective: dto.objective,
          specialAdCategories,
        }),
        'campaign',
      );
      metaCampaignId = campaign.id;
      await this.facebookCampaignRepository.update(tracking.id, {
        metaCampaignId: campaign.id,
      });

      const adSet = await graphPostWithToken<{ id: string }>(
        `/${adAccountId}/adsets`,
        accessToken,
        buildAdSetPayload({
          name: dto.adSetName?.trim() || `${dto.name.trim()} Ad Set`,
          campaignId: campaign.id,
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
        'adset',
      );
      metaAdsetId = adSet.id;
      await this.facebookCampaignRepository.update(tracking.id, {
        metaAdsetId: adSet.id,
      });

      let imageHash: string | undefined;
      let videoId: string | undefined;

      if (imageUrl) {
        imageHash = await uploadAdImageHash(
          adAccountId,
          accessToken,
          imageUrl,
        );
      } else if (videoUrl) {
        videoId = await uploadAdVideoId(adAccountId, accessToken, videoUrl);
      }

      const creative = await graphPostWithToken<{ id: string }>(
        `/${adAccountId}/adcreatives`,
        accessToken,
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
        'creative',
      );
      metaCreativeId = creative.id;
      await this.facebookCampaignRepository.update(tracking.id, {
        metaCreativeId: creative.id,
      });

      const ad = await graphPostWithToken<{ id: string }>(
        `/${adAccountId}/ads`,
        accessToken,
        buildAdPayload({
          name: dto.adName?.trim() || `${dto.name.trim()} Ad`,
          adsetId: adSet.id,
          creativeId: creative.id,
        }),
        'ad',
      );

      await this.facebookCampaignRepository.update(tracking.id, {
        metaAdId: ad.id,
        status: 'PAUSED',
        errorMessage: null,
      });

      await this.auditService.log(restaurantId, 'meta_campaign_created', {
        metadata: {
          metaCampaignId: campaign.id,
          metaAdsetId: adSet.id,
          metaCreativeId: creative.id,
          metaAdId: ad.id,
          adAccountId,
        },
      });

      this.logger.log(
        `Meta campaign published for restaurant ${restaurantId}: campaign=${campaign.id}, ad=${ad.id}`,
      );

      return {
        id: tracking.id,
        metaCampaignId: campaign.id,
        metaAdsetId: adSet.id,
        metaCreativeId: creative.id,
        metaAdId: ad.id,
        status: 'PAUSED',
        adsManagerUrl: adsManagerCampaignsUrl(adAccountId),
        message: 'Campaign published successfully',
      };
    } catch (err) {
      throw await this.handleCreationFailure(
        user.id,
        restaurantId,
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

  async deleteMetaCampaignForRestaurant(
    user: User,
    restaurantId: number,
    metaCampaignId: string,
  ): Promise<{ deleted: true; metaCampaignId: string }> {
    requireAdminRole(
      user,
      'You do not have permission to delete Facebook campaigns.',
    );

    const campaignId = metaCampaignId.trim();
    if (!campaignId) {
      throw new BadRequestException('Meta campaign id is required.');
    }

    const restaurant = await this.loadOwnedRestaurant(user, restaurantId);

    const { accessToken } =
      await this.metaTokenService.assertRestaurantMetaCredentials(restaurant);

    await deleteMetaObject(campaignId, accessToken);

    await this.facebookCampaignRepository.delete({
      restaurantId,
      metaCampaignId: campaignId,
    });

    await this.auditService.log(restaurantId, 'meta_campaign_deleted', {
      metadata: { metaCampaignId: campaignId },
    });

    this.logger.log(
      `Meta campaign ${campaignId} deleted for restaurant ${restaurantId}`,
    );

    return { deleted: true, metaCampaignId: campaignId };
  }

  async listForRestaurant(
    user: User,
    restaurantId: number,
  ): Promise<FacebookCampaign[]> {
    requireAdminRole(
      user,
      'You do not have permission to view Facebook campaigns.',
    );

    await this.loadOwnedRestaurant(user, restaurantId);

    return this.facebookCampaignRepository.find({
      where: { restaurantId },
      order: { createdAt: 'DESC' },
    });
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

  private async handleCreationFailure(
    userId: number,
    restaurantId: number,
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
      restaurantId,
      facebookCampaignId: trackingId,
      step,
      metaErrorCode,
      metaErrorMessage,
      rawResponse,
    });

    await this.auditService.log(restaurantId, 'meta_campaign_failed', {
      errorMessage: userMessage,
      metadata: { step, metaErrorCode },
    });

    this.logger.error(
      `Meta campaign creation failed at step=${step} for restaurant ${restaurantId}: ${metaErrorMessage}`,
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
