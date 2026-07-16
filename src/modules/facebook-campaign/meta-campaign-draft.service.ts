import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import { normalizeCampaignImageUrlForMeta } from '../../utils/disk-file-upload-multer';
import { AdCreativeStepDataDto } from './dto/ad-creative-step-data.dto';
import { AdSetStepDataDto } from './dto/adset-step-data.dto';
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
} from './meta-campaign.constants';
import {
  assertAtLeastOnePlacement,
  assertAudienceCityRadius,
  assertOptimizationGoalForObjective,
  assertScheduleOrder,
  budgetToMetaMinorUnits,
  combineDateAndTime,
} from './meta-adset-draft-validation';
import {
  assertAdCreativeMedia,
  assertAdCreativeDestinationUrl,
  buildDestinationUrlWithParams,
} from './meta-ad-creative-draft-validation';
import { MetaCreativeFormat } from './meta-campaign.constants';

@Injectable()
export class MetaCampaignDraftService {
  constructor(
    @InjectRepository(MetaCampaignDraft)
    private readonly draftRepository: Repository<MetaCampaignDraft>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  async saveCampaignStep(
    user: User,
    businessId: number,
    dto: SaveCampaignStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {

    await this.loadOwnedBusiness(user, businessId);
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

    if (dto.draftId?.trim()) {
      const existing = await this.findEditableDraft(
        user.id,
        businessId,
        dto.draftId.trim(),
      );

      existing.campaignData = campaignData;
      existing.currentStep = Math.max(existing.currentStep, 2);
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
    });

    return this.toResponse(created);
  }

  async saveAdSetStep(
    user: User,
    businessId: number,
    dto: SaveAdSetStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {

    await this.loadOwnedBusiness(user, businessId);

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
    const endDateTime = combineDateAndTime(
      dto.endDate,
      dto.endTime,
      dto.timezone,
    );
    assertScheduleOrder(startDateTime, endDateTime);

    const cboEnabled = campaignData.campaignBudgetOptimization;
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
      endDate: dto.endDate,
      endTime: dto.endTime,
      timezone: dto.timezone,
      startDateTime,
      endDateTime,
      optimizationGoal: dto.optimizationGoal,
      destinationType: dto.destinationType,
      promotedObject: dto.promotedObject,
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
    const saved = await this.draftRepository.save(draft);
    return this.toResponse(saved);
  }

  async saveAdCreativeStep(
    user: User,
    businessId: number,
    dto: SaveAdCreativeStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {

    await this.loadOwnedBusiness(user, businessId);

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
    draft.currentStep = Math.max(draft.currentStep, 4);
    const saved = await this.draftRepository.save(draft);
    return this.toResponse(saved);
  }

  async getDraft(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<MetaCampaignDraftResponseDto> {

    await this.loadOwnedBusiness(user, businessId);

    const draft = await this.draftRepository.findOne({
      where: { id: draftId.trim(), businessId, userId: user.id },
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

    await this.loadOwnedBusiness(user, businessId);

    const drafts = await this.draftRepository.find({
      where: {
        businessId,
        userId: user.id,
        status: In(['draft', 'failed', 'publishing']),
      },
      order: { updatedAt: 'DESC' },
    });

    return drafts.map((draft) => this.toResponse(draft));
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

  private async findEditableDraft(
    userId: number,
    businessId: number,
    draftId: string,
  ): Promise<MetaCampaignDraft> {
    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        businessId,
        userId,
      },
    });

    if (!draft) {
      throw new NotFoundException('Campaign draft not found.');
    }

    if (draft.status === 'published' && draft.metaAdId) {
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
    }

    return draft;
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


  private toResponse(draft: MetaCampaignDraft): MetaCampaignDraftResponseDto {
    return {
      id: draft.id,
      businessId: draft.businessId,
      currentStep: draft.currentStep,
      status: draft.status,
      campaignData: (draft.campaignData as CampaignStepDataDto | null) ?? null,
      adSetData: (draft.adSetData as AdSetStepDataDto | null) ?? null,
      adCreativeData: (draft.adCreativeData as AdCreativeStepDataDto | null) ?? null,
      metaCampaignId: draft.metaCampaignId,
      metaAdsetId: draft.metaAdsetId,
      metaCreativeId: draft.metaCreativeId,
      metaAdId: draft.metaAdId,
      errorMessage: draft.errorMessage,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }
}
