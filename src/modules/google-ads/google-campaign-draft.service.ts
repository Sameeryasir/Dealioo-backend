import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { GoogleCampaignDraft } from '../../db/entities/google-campaign-draft.entity';
import type { GoogleCampaignBuilderDraftData } from '../../db/entities/google-campaign-builder-draft.types';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  googleCampaignPermissionKeysFor,
  type GoogleCampaignAccessAction,
} from '../member/member.constants';
import {
  GoogleCampaignDraftResumeResponseDto,
  SaveGoogleCampaignInfoStepResponseDto,
  SaveGoogleGoalDetailsStepResponseDto,
  SaveGoogleGoalStepResponseDto,
} from './dto/google-campaign-draft-response.dto';
import { SaveGoogleCampaignInfoStepDto } from './dto/save-google-campaign-info-step.dto';
import { SaveGoogleGoalDetailsStepDto } from './dto/save-google-goal-details-step.dto';
import { SaveGoogleGoalStepDto } from './dto/save-google-goal-step.dto';
import {
  GoogleCampaignStepSaveResponseDto,
  SaveGoogleAdsStepDto,
  SaveGoogleAudienceStepDto,
  SaveGoogleBudgetStepDto,
  SaveGoogleExtrasStepDto,
  SaveGoogleKeywordsStepDto,
  SaveGoogleLanguagesStepDto,
  SaveGoogleLocationsStepDto,
} from './dto/save-google-remaining-steps.dto';
import { UpdateGoogleDraftProgressDto } from './dto/update-google-draft-progress.dto';
import {
  DRAFT_CONFLICT_MESSAGE,
  GOOGLE_DRAFT_EDITABLE_STATUSES,
  GoogleCampaignDraftStatus,
  type GoogleCampaignDraftStatusValue,
} from './google-campaign-draft.constants';
import {
  createDefaultGoogleCampaignDraftData,
} from './google-campaign-draft-defaults';

type DraftColumnPatch = {
  draftData?: GoogleCampaignBuilderDraftData | null;
  campaignName?: string | null;
  businessName?: string | null;
  goal?: GoogleCampaignDraft['goal'];
  campaignType?: GoogleCampaignDraft['campaignType'];
  dailyBudget?: string | null;
  currentStep?: number;
  completedSteps?: number[];
  lastSavedAt?: Date | null;
  status?: string;
  errorMessage?: string | null;
  publishStatus?: string | null;
  publishJobId?: string | null;
  publishStep?: string | null;
  publishProgress?: number;
  publishedAt?: Date | null;
  lastIdempotencyKey?: string | null;
  lastIdempotencyResponse?: Record<string, unknown> | null;
  updatedBy?: number | null;
};

@Injectable()
export class GoogleCampaignDraftService {
  constructor(
    @InjectRepository(GoogleCampaignDraft)
    private readonly draftRepository: Repository<GoogleCampaignDraft>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  
  async saveGoalStep(
    user: User,
    businessId: number,
    dto: SaveGoogleGoalStepDto,
    idempotencyKey?: string,
  ): Promise<SaveGoogleGoalStepResponseDto> {
    await this.assertBusinessAccess(user, businessId);

    if (!dto.goal) {
      throw new BadRequestException('Marketing goal is required.');
    }

    const now = new Date();

    
    if (dto.draftId?.trim()) {
      if (dto.expectedVersion == null) {
        throw new BadRequestException(
          'expectedVersion is required when updating a draft.',
        );
      }

      const existing = await this.draftRepository.findOne({
        where: {
          id: dto.draftId.trim(),
          businessId,
          userId: user.id,
        },
      });

      if (existing) {
        const editable = await this.findEditableDraft(
          user.id,
          businessId,
          existing.id,
        );

        const cached =
          this.getCachedIdempotentResponse<SaveGoogleGoalStepResponseDto>(
            editable,
            idempotencyKey,
          );
        if (cached) return cached;

        const draftData = this.applyGoalToDraftData(
          editable.draftData ?? createDefaultGoogleCampaignDraftData(),
          dto.goal,
          editable.businessName ?? editable.draftData?.businessName,
        );

        return this.dataSource.transaction(async (manager) => {
          const saved = await this.updateDraftWithOcc(manager, {
            draft: editable,
            expectedVersion: dto.expectedVersion!,
            userId: user.id,
            businessId,
            now,
            fields: {
              draftData,
              goal: dto.goal,
              campaignName: draftData.campaignName,
              campaignType: draftData.campaignType,
              businessName: draftData.businessName || editable.businessName,
              dailyBudget:
                draftData.dailyBudget != null
                  ? String(draftData.dailyBudget)
                  : null,
              currentStep: Math.max(editable.currentStep, 2),
              completedSteps: this.mergeCompletedSteps(editable.completedSteps, [
                1,
              ]),
              lastSavedAt: now,
              status: GoogleCampaignDraftStatus.DRAFT,
              errorMessage: null,
              updatedBy: user.id,
            },
            idempotencyKey,
            mapResponse: (row) => this.toGoalStepResponse(row),
          });
          return saved;
        });
      }
    }

    
    return this.dataSource.transaction(async (manager) => {
      const draftData = this.applyGoalToDraftData(
        createDefaultGoogleCampaignDraftData(),
        dto.goal,
      );

      const entity = manager.create(GoogleCampaignDraft, {
        userId: user.id,
        businessId,
        createdBy: user.id,
        updatedBy: user.id,
        currentStep: 2,
        status: GoogleCampaignDraftStatus.DRAFT,
        draftData,
        campaignName: draftData.campaignName,
        goal: dto.goal,
        campaignType: draftData.campaignType,
        businessName: draftData.businessName || null,
        dailyBudget: String(draftData.dailyBudget),
        googleCampaignId: null,
        errorMessage: null,
        version: 1,
        completedSteps: [1],
        lastSavedAt: now,
        publishStatus: null,
        publishJobId: null,
        publishStep: null,
        publishProgress: 0,
        publishedAt: null,
        lastIdempotencyKey: idempotencyKey?.trim() || null,
        lastIdempotencyResponse: null,
      });

      const created = await manager.save(entity);
      const response = this.toGoalStepResponse(created);

      
      if (idempotencyKey?.trim()) {
        created.lastIdempotencyKey = idempotencyKey.trim();
        created.lastIdempotencyResponse = response as unknown as Record<
          string,
          unknown
        >;
        await manager.save(created);
      }

      return response;
    });
  }

  
  async saveGoalDetailsStep(
    user: User,
    businessId: number,
    dto: SaveGoogleGoalDetailsStepDto,
    idempotencyKey?: string,
  ): Promise<SaveGoogleGoalDetailsStepResponseDto> {
    await this.assertBusinessAccess(user, businessId);

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      dto.draftId.trim(),
    );

    const cached =
      this.getCachedIdempotentResponse<SaveGoogleGoalDetailsStepResponseDto>(
        draft,
        idempotencyKey,
      );
    if (cached) return cached;

    if (!draft.goal && !draft.draftData?.goal) {
      throw new BadRequestException(
        'Complete Step 1 (Marketing Goal) before saving goal details.',
      );
    }

    const goal = draft.goal ?? draft.draftData?.goal ?? null;
    if (!goal) {
      throw new BadRequestException(
        'Complete Step 1 (Marketing Goal) before saving goal details.',
      );
    }

    this.assertGoalDetailsBusinessRules(goal, dto);

    const base = draft.draftData ?? createDefaultGoogleCampaignDraftData();
    const websiteUrl = dto.websiteUrl?.trim() ?? base.websiteUrl;
    const landingPageUrl = dto.landingPageUrl?.trim() ?? base.landingPageUrl;
    const businessPhone = dto.businessPhone?.trim() ?? base.businessPhone;
    const businessName = dto.businessName?.trim() ?? base.businessName;

    const draftData: GoogleCampaignBuilderDraftData = {
      ...base,
      goal,
      salesChannel: dto.salesChannel ?? base.salesChannel,
      websiteUrl,
      businessLocation: dto.businessLocation?.trim() ?? base.businessLocation,
      businessLocationLat:
        dto.businessLocationLat !== undefined
          ? dto.businessLocationLat
          : (base.businessLocationLat ?? null),
      businessLocationLng:
        dto.businessLocationLng !== undefined
          ? dto.businessLocationLng
          : (base.businessLocationLng ?? null),
      businessPhone,
      phoneNumber: businessPhone || base.phoneNumber,
      leadContactMethods: dto.leadContactMethods ?? base.leadContactMethods,
      destinationType:
        dto.destinationType !== undefined
          ? dto.destinationType
          : (base.destinationType ?? null),
      selectedFunnelId:
        dto.selectedFunnelId !== undefined
          ? dto.selectedFunnelId
          : (base.selectedFunnelId ?? null),
      selectedFunnelName:
        dto.selectedFunnelName !== undefined
          ? dto.selectedFunnelName.trim()
          : (base.selectedFunnelName ?? ''),
      landingPageUrl: landingPageUrl || websiteUrl,
      phoneCountryCode:
        dto.phoneCountryCode?.trim() ?? base.phoneCountryCode ?? '+1',
      whatsAppNumber: dto.whatsAppNumber?.trim() ?? base.whatsAppNumber ?? '',
      whatsAppMessage:
        dto.whatsAppMessage?.trim() ?? base.whatsAppMessage ?? '',
      bookingPageUrl: dto.bookingPageUrl?.trim() ?? base.bookingPageUrl ?? '',
      googleLeadFormHeadline:
        dto.googleLeadFormHeadline?.trim() ??
        base.googleLeadFormHeadline ??
        '',
      googleLeadFormDescription:
        dto.googleLeadFormDescription?.trim() ??
        base.googleLeadFormDescription ??
        '',
      googleLeadFormFields:
        dto.googleLeadFormFields ??
        base.googleLeadFormFields ??
        ['FULL_NAME', 'EMAIL', 'PHONE'],
      googleLeadFormCta:
        dto.googleLeadFormCta?.trim() ?? base.googleLeadFormCta ?? 'GET_QUOTE',
      googleLeadFormCtaDescription:
        dto.googleLeadFormCtaDescription?.trim() ??
        base.googleLeadFormCtaDescription ??
        '',
      googleLeadFormPrivacyUrl:
        dto.googleLeadFormPrivacyUrl?.trim() ??
        base.googleLeadFormPrivacyUrl ??
        '',
      googleLeadFormThankYouHeadline:
        dto.googleLeadFormThankYouHeadline?.trim() ??
        base.googleLeadFormThankYouHeadline ??
        '',
      googleLeadFormThankYouMessage:
        dto.googleLeadFormThankYouMessage?.trim() ??
        base.googleLeadFormThankYouMessage ??
        '',
      googleLeadFormPostSubmitAction:
        dto.googleLeadFormPostSubmitAction?.trim() ??
        base.googleLeadFormPostSubmitAction ??
        'VISIT_WEBSITE',
      googleLeadFormPostSubmitUrl:
        dto.googleLeadFormPostSubmitUrl?.trim() ??
        base.googleLeadFormPostSubmitUrl ??
        '',
      trafficAction: dto.trafficAction ?? base.trafficAction,
      businessName,
      extensionBusinessName: businessName || base.extensionBusinessName,
      businessCategory: dto.businessCategory?.trim() ?? base.businessCategory,
      businessAddress: dto.businessAddress?.trim() ?? base.businessAddress,
      businessHours: dto.businessHours?.trim() ?? base.businessHours,
      appName: dto.appName?.trim() ?? base.appName,
      goalDetailSubstep:
        dto.goalDetailSubstep ??
        (goal === 'WEBSITE_TRAFFIC' ? 1 : base.goalDetailSubstep),
      currentStep: Math.max(base.currentStep ?? 2, 3),
      savedAt: new Date().toISOString(),
    };

    const now = new Date();

    return this.dataSource.transaction(async (manager) => {
      return this.updateDraftWithOcc(manager, {
        draft,
        expectedVersion: dto.expectedVersion,
        userId: user.id,
        businessId,
        now,
        fields: {
          draftData,
          goal,
          campaignName: draftData.campaignName,
          campaignType: draftData.campaignType,
          businessName: draftData.businessName || draft.businessName,
          dailyBudget:
            draftData.dailyBudget != null
              ? String(draftData.dailyBudget)
              : null,
          currentStep: Math.max(draft.currentStep, 3),
          completedSteps: this.mergeCompletedSteps(draft.completedSteps, [
            1, 2,
          ]),
          lastSavedAt: now,
          status: GoogleCampaignDraftStatus.DRAFT,
          errorMessage: null,
          updatedBy: user.id,
        },
        idempotencyKey,
        mapResponse: (row) => this.toGoalDetailsStepResponse(row),
      });
    });
  }

  
  async saveCampaignInfoStep(
    user: User,
    businessId: number,
    dto: SaveGoogleCampaignInfoStepDto,
    idempotencyKey?: string,
  ): Promise<SaveGoogleCampaignInfoStepResponseDto> {
    await this.assertBusinessAccess(user, businessId);

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      dto.draftId.trim(),
    );

    const cached =
      this.getCachedIdempotentResponse<SaveGoogleCampaignInfoStepResponseDto>(
        draft,
        idempotencyKey,
      );
    if (cached) return cached;

    if (!draft.goal && !draft.draftData?.goal) {
      throw new BadRequestException(
        'Complete Step 1 (Marketing Goal) before saving campaign info.',
      );
    }

    if (!dto.campaignName?.trim()) {
      throw new BadRequestException('Add a campaign name.');
    }
    if (!dto.businessName?.trim()) {
      throw new BadRequestException('Add your business name.');
    }
    if (dto.websiteUrl?.trim() && !this.isValidHttpUrl(dto.websiteUrl)) {
      throw new BadRequestException('Enter a valid website URL.');
    }

    const base = draft.draftData ?? createDefaultGoogleCampaignDraftData();
    const campaignName = dto.campaignName.trim();
    const businessName = dto.businessName.trim();
    const websiteUrl = dto.websiteUrl?.trim() ?? base.websiteUrl;
    const businessCategory =
      dto.businessCategory?.trim() ?? base.businessCategory;
    const logoFileName = dto.logoFileName?.trim() ?? base.logoFileName;
    const rawLogoUrl = dto.logoPreviewUrl?.trim() ?? base.logoPreviewUrl;
    const logoPreviewUrl = rawLogoUrl.startsWith('blob:')
      ? base.logoPreviewUrl
      : rawLogoUrl;

    const draftData: GoogleCampaignBuilderDraftData = {
      ...base,
      campaignName,
      businessName,
      extensionBusinessName:
        dto.extensionBusinessName?.trim() ||
        businessName ||
        base.extensionBusinessName,
      websiteUrl,
      businessCategory,
      logoFileName,
      logoPreviewUrl,
      businessDescription:
        dto.businessDescription?.trim() ?? base.businessDescription ?? '',
      currentStep: Math.max(base.currentStep ?? 3, 4),
      savedAt: new Date().toISOString(),
    };

    const now = new Date();

    return this.dataSource.transaction(async (manager) => {
      return this.updateDraftWithOcc(manager, {
        draft,
        expectedVersion: dto.expectedVersion,
        userId: user.id,
        businessId,
        now,
        fields: {
          draftData,
          campaignName,
          businessName,
          campaignType: draftData.campaignType,
          dailyBudget:
            draftData.dailyBudget != null
              ? String(draftData.dailyBudget)
              : null,
          currentStep: Math.max(draft.currentStep, 4),
          completedSteps: this.mergeCompletedSteps(draft.completedSteps, [
            1, 2, 3,
          ]),
          lastSavedAt: now,
          status: GoogleCampaignDraftStatus.DRAFT,
          errorMessage: null,
          updatedBy: user.id,
        },
        idempotencyKey,
        mapResponse: (row) => this.toCampaignInfoStepResponse(row),
      });
    });
  }

  async getDraft(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<GoogleCampaignDraftResumeResponseDto> {
    await this.assertBusinessAccess(user, businessId, 'view');

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

    return {
      id: draft.id,
      businessId: draft.businessId,
      status: draft.status,
      currentStep: draft.currentStep,
      completedSteps: draft.completedSteps ?? [],
      version: draft.version ?? 1,
      lastSavedAt: draft.lastSavedAt,
      campaignName: draft.campaignName,
      goal: draft.goal,
      draftData: draft.draftData,
      publishStatus: draft.publishStatus ?? null,
      publishStep: draft.publishStep ?? null,
      publishProgress: draft.publishProgress ?? null,
      errorMessage: draft.errorMessage ?? null,
    };
  }

  async updateDraftProgress(
    user: User,
    businessId: number,
    draftId: string,
    dto: UpdateGoogleDraftProgressDto,
    idempotencyKey?: string,
  ): Promise<{
    id: string;
    currentStep: number;
    lastSavedAt: Date | null;
    version: number;
  }> {
    await this.assertBusinessAccess(user, businessId);

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      draftId.trim(),
    );

    const cached = this.getCachedIdempotentResponse<{
      id: string;
      currentStep: number;
      lastSavedAt: Date | null;
      version: number;
    }>(draft, idempotencyKey);
    if (cached) return cached;

    const now = new Date();
    const nextDraftData = draft.draftData
      ? {
          ...draft.draftData,
          currentStep: dto.currentStep,
          goalDetailSubstep:
            dto.goalDetailSubstep ?? draft.draftData.goalDetailSubstep,
          savedAt: now.toISOString(),
        }
      : draft.draftData;

    return this.dataSource.transaction(async (manager) => {
      return this.updateDraftWithOcc(manager, {
        draft,
        expectedVersion: dto.expectedVersion,
        userId: user.id,
        businessId,
        now,
        fields: {
          currentStep: dto.currentStep,
          draftData: nextDraftData,
          lastSavedAt: now,
          status: GoogleCampaignDraftStatus.DRAFT,
          errorMessage: null,
          updatedBy: user.id,
        },
        idempotencyKey,
        mapResponse: (row) => ({
          id: row.id,
          currentStep: row.currentStep,
          lastSavedAt: row.lastSavedAt,
          version: row.version ?? 1,
        }),
      });
    });
  }

  async saveBudgetStep(
    user: User,
    businessId: number,
    dto: SaveGoogleBudgetStepDto,
    idempotencyKey?: string,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    if (dto.startDate && dto.endDate && dto.endDate < dto.startDate) {
      throw new BadRequestException(
        'End date must be on or after the start date.',
      );
    }

    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 4,
      nextStep: 5,
      apply: (base) => ({
        ...base,
        dailyBudget: dto.dailyBudget,
        startDate: dto.startDate?.trim() ?? base.startDate,
        endDate: dto.endDate?.trim() ?? base.endDate,
      }),
      afterApply: (patch, data) => {
        patch.dailyBudget = String(data.dailyBudget);
      },
      idempotencyKey,
    });
  }

  async saveLocationsStep(
    user: User,
    businessId: number,
    dto: SaveGoogleLocationsStepDto,
    idempotencyKey?: string,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    const normalizeLocation = (
      row: SaveGoogleLocationsStepDto['targetLocations'][number],
      fallbackRadius: number,
      fallbackUnit: 'KILOMETERS' | 'MILES',
    ) => {
      if (row.type === 'country') {
        return { ...row, radiusValue: undefined, radiusUnit: undefined };
      }
      return {
        ...row,
        radiusValue:
          typeof row.radiusValue === 'number' && row.radiusValue >= 1
            ? row.radiusValue
            : fallbackRadius,
        radiusUnit: row.radiusUnit === 'MILES' ? 'MILES' : fallbackUnit,
      };
    };

    const fallbackRadius = dto.radiusValue ?? 16;
    const fallbackUnit =
      dto.radiusUnit === 'MILES' ? 'MILES' : 'KILOMETERS';
    const targetLocations = dto.targetLocations.map((row) =>
      normalizeLocation(row, fallbackRadius, fallbackUnit),
    );
    const excludedLocationTargets = (dto.excludedLocationTargets ?? []).map(
      (row) => normalizeLocation(row, 16, 'KILOMETERS'),
    );

    const pinWithoutRadius = targetLocations.find((row) => {
      if (row.type === 'country') return false;
      const hasCoords =
        typeof row.latitude === 'number' && typeof row.longitude === 'number';
      const hasRadius =
        typeof row.radiusValue === 'number' && row.radiusValue >= 1;
      return !hasCoords || !hasRadius;
    });
    if (pinWithoutRadius) {
      throw new BadRequestException(
        `Set a map radius for ${pinWithoutRadius.name} before continuing.`,
      );
    }

    const pinCenter =
      dto.radiusCenter ??
      targetLocations.find((row) => row.type !== 'country') ??
      null;
    const pinLat =
      dto.radiusLat ??
      (typeof pinCenter?.latitude === 'number' ? pinCenter.latitude : null);
    const pinLng =
      dto.radiusLng ??
      (typeof pinCenter?.longitude === 'number' ? pinCenter.longitude : null);
    const hasPinLocation = targetLocations.some(
      (row) => row.type !== 'country',
    );
    const radiusEnabled =
      dto.radiusEnabled === true ||
      (hasPinLocation && pinLat != null && pinLng != null);

    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 5,
      nextStep: 6,
      apply: (base) => ({
        ...base,
        targetLocations,
        excludedLocationTargets:
          dto.excludedLocationTargets != null
            ? excludedLocationTargets
            : base.excludedLocationTargets,
        countries: dto.countries ?? base.countries,
        regions: dto.regions ?? base.regions,
        cities: dto.cities ?? base.cities,
        excludedLocations: dto.excludedLocations ?? base.excludedLocations,
        radiusEnabled,
        radiusCenter: pinCenter ?? dto.radiusCenter ?? null,
        radiusLat: pinLat,
        radiusLng: pinLng,
        radiusValue:
          typeof pinCenter?.radiusValue === 'number'
            ? pinCenter.radiusValue
            : (dto.radiusValue ?? base.radiusValue ?? 16),
        radiusUnit:
          pinCenter?.radiusUnit === 'MILES'
            ? 'MILES'
            : (dto.radiusUnit ?? base.radiusUnit),
        radiusTargeting:
          dto.radiusTargeting ??
          (radiusEnabled && pinCenter?.radiusValue
            ? `${pinCenter.radiusValue} ${pinCenter.radiusUnit === 'MILES' ? 'mi' : 'km'} radius`
            : base.radiusTargeting),
        presenceOption: dto.presenceOption ?? base.presenceOption,
      }),
      idempotencyKey,
    });
  }

  async saveLanguagesStep(
    user: User,
    businessId: number,
    dto: SaveGoogleLanguagesStepDto,
    idempotencyKey?: string,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 6,
      nextStep: 7,
      apply: (base) => ({
        ...base,
        languages: dto.languages.map((row) => row.trim()).filter(Boolean),
      }),
      idempotencyKey,
    });
  }

  async saveAudienceStep(
    user: User,
    businessId: number,
    dto: SaveGoogleAudienceStepDto,
    idempotencyKey?: string,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 7,
      nextStep: 8,
      apply: (base) => ({
        ...base,
        ageRanges: dto.ageRanges,
        gender: dto.gender ?? base.gender,
        householdIncome: dto.householdIncome?.trim() ?? base.householdIncome,
        interests: dto.interests ?? base.interests,
        idealCustomers: dto.idealCustomers ?? base.idealCustomers ?? [],
      }),
      idempotencyKey,
    });
  }

  async saveKeywordsStep(
    user: User,
    businessId: number,
    dto: SaveGoogleKeywordsStepDto,
    idempotencyKey?: string,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    if (!dto.businessType?.trim()) {
      throw new BadRequestException('Choose your business type.');
    }

    const suggested = dto.suggestedKeywords ?? [];
    const custom = (dto.customKeywords ?? [])
      .map((row) => row.trim())
      .filter(Boolean);
    const enabledCount =
      suggested.filter((row) => row.enabled && row.text.trim()).length +
      custom.length;

    if (enabledCount === 0) {
      throw new BadRequestException('Keep or add at least one keyword.');
    }

    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 8,
      nextStep: 9,
      apply: (base) => ({
        ...base,
        businessType: dto.businessType.trim(),
        suggestedKeywords: suggested,
        customKeywords: custom,
        negativeKeywords: (dto.negativeKeywords ?? base.negativeKeywords)
          .map((row) => row.trim())
          .filter(Boolean),
        keywordMatchType: dto.keywordMatchType ?? base.keywordMatchType,
        productsServices:
          dto.productsServices ?? base.productsServices ?? [],
      }),
      idempotencyKey,
    });
  }

  async saveAdsStep(
    user: User,
    businessId: number,
    dto: SaveGoogleAdsStepDto,
    idempotencyKey?: string,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    const ad = dto.ads[0];
    if (!ad) {
      throw new BadRequestException('Create at least one ad.');
    }
    if (!this.isValidHttpUrl(ad.finalUrl)) {
      throw new BadRequestException('Add a valid final URL.');
    }
    const headlines = ad.headlines.map((h) => h.trim()).filter(Boolean);
    if (headlines.length < 3) {
      throw new BadRequestException('Keep at least 3 headlines.');
    }
    const descriptions = ad.descriptions.map((d) => d.trim()).filter(Boolean);
    if (descriptions.length < 2) {
      throw new BadRequestException('Keep at least 2 descriptions.');
    }

    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 9,
      nextStep: 10,
      apply: (base) => ({
        ...base,
        ads: dto.ads.map((row) => ({
          id: row.id,
          finalUrl: row.finalUrl.trim(),
          headlines: row.headlines,
          descriptions: row.descriptions,
          path1: row.path1?.trim() ?? '',
          path2: row.path2?.trim() ?? '',
          callToAction: row.callToAction,
        })),
        adsGenerated: dto.adsGenerated ?? base.adsGenerated,
      }),
      idempotencyKey,
    });
  }

  async saveExtrasStep(
    user: User,
    businessId: number,
    dto: SaveGoogleExtrasStepDto,
    idempotencyKey?: string,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 10,
      nextStep: 11,
      apply: (base) => ({
        ...base,
        extensionBusinessName:
          dto.extensionBusinessName?.trim() ?? base.extensionBusinessName,
        phoneNumber: dto.phoneNumber?.trim() ?? base.phoneNumber,
        businessAddress: dto.businessAddress?.trim() ?? base.businessAddress,
        businessHours: dto.businessHours?.trim() ?? base.businessHours,
        callouts: dto.callouts ?? base.callouts,
        structuredSnippetHeader:
          dto.structuredSnippetHeader?.trim() ?? base.structuredSnippetHeader,
        structuredSnippetValues:
          dto.structuredSnippetValues ?? base.structuredSnippetValues,
        useLocationExtension:
          dto.useLocationExtension ?? base.useLocationExtension,
        sitelinks: (dto.sitelinks ?? base.sitelinks).map((row) => ({
          id: row.id,
          text: row.text,
          url: row.url,
          description1: row.description1 ?? '',
          description2: row.description2 ?? '',
          enabled: row.enabled,
        })),
        assetsGenerated: dto.assetsGenerated ?? base.assetsGenerated,
      }),
      idempotencyKey,
    });
  }

  
  private async commitWizardStep<T = GoogleCampaignStepSaveResponseDto>(
    user: User,
    businessId: number,
    draftId: string,
    options: {
      expectedVersion: number;
      completedStep: number;
      nextStep: number;
      apply: (
        base: GoogleCampaignBuilderDraftData,
      ) => GoogleCampaignBuilderDraftData;
      afterApply?: (
        patch: DraftColumnPatch,
        data: GoogleCampaignBuilderDraftData,
      ) => void;
      idempotencyKey?: string;
      mapResponse?: (draft: GoogleCampaignDraft) => T;
    },
  ): Promise<T> {
    await this.assertBusinessAccess(user, businessId);

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      draftId.trim(),
    );

    const cached = this.getCachedIdempotentResponse<T>(
      draft,
      options.idempotencyKey,
    );
    if (cached) return cached;

    const base = draft.draftData ?? createDefaultGoogleCampaignDraftData();
    const draftData: GoogleCampaignBuilderDraftData = {
      ...options.apply(base),
      currentStep: Math.max(base.currentStep ?? 1, options.nextStep),
      savedAt: new Date().toISOString(),
    };

    const now = new Date();
    const fields: DraftColumnPatch = {
      draftData,
      campaignName: draftData.campaignName || draft.campaignName,
      businessName: draftData.businessName || draft.businessName,
      goal: draftData.goal ?? draft.goal,
      campaignType: draftData.campaignType,
      currentStep: Math.max(draft.currentStep, options.nextStep),
      
      completedSteps: this.mergeCompletedSteps(
        draft.completedSteps,
        Array.from({ length: options.completedStep }, (_, i) => i + 1),
      ),
      lastSavedAt: now,
      status: GoogleCampaignDraftStatus.DRAFT,
      errorMessage: null,
      updatedBy: user.id,
    };

    options.afterApply?.(fields, draftData);

    return this.dataSource.transaction(async (manager) => {
      return this.updateDraftWithOcc(manager, {
        draft,
        expectedVersion: options.expectedVersion,
        userId: user.id,
        businessId,
        now,
        fields,
        idempotencyKey: options.idempotencyKey,
        mapResponse:
          options.mapResponse ??
          ((row) =>
            ({
              id: row.id,
              businessId: row.businessId,
              currentStep: row.currentStep,
              completedSteps: row.completedSteps ?? [],
              version: row.version ?? 1,
              lastSavedAt: row.lastSavedAt,
            }) as T),
      });
    });
  }

  
  private async updateDraftWithOcc<T>(
    manager: EntityManager,
    params: {
      draft: GoogleCampaignDraft;
      expectedVersion: number;
      userId: number;
      businessId: number;
      now: Date;
      fields: DraftColumnPatch;
      idempotencyKey?: string;
      mapResponse: (draft: GoogleCampaignDraft) => T;
    },
  ): Promise<T> {
    const {
      draft,
      expectedVersion,
      userId,
      businessId,
      now,
      fields,
      idempotencyKey,
      mapResponse,
    } = params;

    const setPayload: Record<string, unknown> = {
      ...fields,
      
      version: () => '"version" + 1',
      updatedAt: now,
      updatedBy: fields.updatedBy ?? userId,
    };

    if (idempotencyKey?.trim()) {
      
      setPayload.lastIdempotencyKey = idempotencyKey.trim();
    }

    const result = await manager
      .createQueryBuilder()
      .update(GoogleCampaignDraft)
      .set(setPayload)
      .where(
        'id = :id AND version = :expectedVersion AND business_id = :businessId AND user_id = :userId',
        {
          id: draft.id,
          expectedVersion,
          businessId,
          userId,
        },
      )
      .execute();

    if (!result.affected) {
      const current = await manager.findOne(GoogleCampaignDraft, {
        where: { id: draft.id, businessId, userId },
      });
      throw new ConflictException({
        message: DRAFT_CONFLICT_MESSAGE,
        currentVersion: current?.version ?? expectedVersion,
      });
    }

    const reloaded = await manager.findOne(GoogleCampaignDraft, {
      where: { id: draft.id, businessId, userId },
    });

    if (!reloaded) {
      throw new NotFoundException('Google campaign draft not found.');
    }

    const response = mapResponse(reloaded);

    
    if (idempotencyKey?.trim()) {
      await manager
        .createQueryBuilder()
        .update(GoogleCampaignDraft)
        .set({
          lastIdempotencyKey: idempotencyKey.trim(),
          
          lastIdempotencyResponse: response as never,
        })
        .where('id = :id AND business_id = :businessId AND user_id = :userId', {
          id: draft.id,
          businessId,
          userId,
        })
        .execute();
    }

    return response;
  }

  private getCachedIdempotentResponse<T>(
    draft: GoogleCampaignDraft,
    idempotencyKey?: string,
  ): T | null {
    const key = idempotencyKey?.trim();
    if (
      key &&
      draft.lastIdempotencyKey === key &&
      draft.lastIdempotencyResponse
    ) {
      return draft.lastIdempotencyResponse as T;
    }
    return null;
  }

  private isValidHttpUrl(value?: string): boolean {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) return false;
    try {
      const url = new URL(trimmed);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private assertGoalDetailsBusinessRules(
    goal: NonNullable<GoogleCampaignBuilderDraftData['goal']>,
    dto: SaveGoogleGoalDetailsStepDto,
  ): void {
    if (goal === 'SALES') {
      if (!dto.salesChannel) {
        throw new BadRequestException('Choose how customers buy from you.');
      }
      if (
        (dto.salesChannel === 'WEBSITE' ||
          dto.salesChannel === 'ONLINE_STORE' ||
          dto.salesChannel === 'MULTIPLE') &&
        !this.isValidHttpUrl(dto.websiteUrl)
      ) {
        throw new BadRequestException('Enter a valid website URL.');
      }
      if (
        (dto.salesChannel === 'PHYSICAL_STORE' ||
          dto.salesChannel === 'MULTIPLE') &&
        !dto.businessLocation?.trim()
      ) {
        throw new BadRequestException('Add your business location.');
      }
      if (
        dto.salesChannel === 'PHONE_ORDERS' &&
        !dto.businessPhone?.trim()
      ) {
        throw new BadRequestException('Add a phone number.');
      }
    }

    if (goal === 'LEADS') {
      const methods = (dto.leadContactMethods ?? []).filter(
        (id) => id !== 'WHATSAPP' && id !== 'APPOINTMENT_BOOKING',
      );
      const primary = methods[0] ?? null;
      if (!primary || methods.length !== 1) {
        throw new BadRequestException('Choose one primary lead method.');
      }
      if (
        primary === 'CONTACT_FORM' &&
        !this.isValidHttpUrl(dto.landingPageUrl || dto.websiteUrl)
      ) {
        throw new BadRequestException('Add a landing page URL.');
      }
      if (primary === 'GOOGLE_LEAD_FORM') {
        if (!dto.businessName?.trim()) {
          throw new BadRequestException('Add a business name.');
        }
        if (!dto.googleLeadFormHeadline?.trim()) {
          throw new BadRequestException('Add a lead form headline.');
        }
        if (!dto.googleLeadFormDescription?.trim()) {
          throw new BadRequestException('Add a lead form description.');
        }
        if (!dto.googleLeadFormCta?.trim()) {
          throw new BadRequestException('Choose a call to action.');
        }
        if (!dto.googleLeadFormCtaDescription?.trim()) {
          throw new BadRequestException('Add a CTA description.');
        }
        if (!dto.googleLeadFormFields?.length) {
          throw new BadRequestException('Select at least one form field.');
        }
        if (!this.isValidHttpUrl(dto.googleLeadFormPrivacyUrl)) {
          throw new BadRequestException('Add a privacy policy URL.');
        }
        if (!dto.googleLeadFormThankYouHeadline?.trim()) {
          throw new BadRequestException('Add a thank-you headline.');
        }
        if (!dto.googleLeadFormThankYouMessage?.trim()) {
          throw new BadRequestException('Add a thank-you message.');
        }
        if (!dto.googleLeadFormPostSubmitAction?.trim()) {
          throw new BadRequestException('Choose a post-submit action.');
        }
        if (
          dto.googleLeadFormPostSubmitAction === 'VISIT_WEBSITE' &&
          !this.isValidHttpUrl(
            dto.googleLeadFormPostSubmitUrl || dto.websiteUrl || dto.landingPageUrl,
          )
        ) {
          throw new BadRequestException(
            'Add a website URL for the post-submit action.',
          );
        }
      }
      if (primary === 'PHONE_CALLS' && !dto.businessPhone?.trim()) {
        throw new BadRequestException('Add a phone number.');
      }
    }

    if (goal === 'WEBSITE_TRAFFIC') {
      if (!this.isValidHttpUrl(dto.websiteUrl)) {
        throw new BadRequestException(
          'Where should visitors go? Add a valid URL.',
        );
      }
      if (!dto.trafficAction) {
        throw new BadRequestException('Choose an action for visitors.');
      }
    }

    if (goal === 'AWARENESS') {
      if (!dto.businessName?.trim()) {
        throw new BadRequestException('Add your business name.');
      }
    }

    if (goal === 'LOCAL_VISITS') {
      if (!dto.businessLocation?.trim()) {
        throw new BadRequestException('Add your business location.');
      }
      if (!dto.businessPhone?.trim()) {
        throw new BadRequestException('Add a phone number.');
      }
    }

    if (goal === 'APP_PROMOTION' && !dto.appName?.trim()) {
      throw new BadRequestException('Add your app name.');
    }
  }

  private applyGoalToDraftData(
    base: GoogleCampaignBuilderDraftData,
    goal: SaveGoogleGoalStepDto['goal'],
    businessName?: string | null,
  ): GoogleCampaignBuilderDraftData {
    const name = businessName?.trim() || base.businessName;

    return {
      ...base,
      goal,
      goalDetailSubstep: 0,
      businessName: name || base.businessName,
      currentStep: Math.max(base.currentStep ?? 1, 2),
      savedAt: new Date().toISOString(),
    };
  }

  private async findEditableDraft(
    userId: number,
    businessId: number,
    draftId: string,
  ): Promise<GoogleCampaignDraft> {
    const draft = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        businessId,
        userId,
      },
    });

    if (!draft) {
      throw new NotFoundException('Google campaign draft not found.');
    }

    const status = draft.status as GoogleCampaignDraftStatusValue;

    
    if (status === GoogleCampaignDraftStatus.PUBLISHED) {
      throw new BadRequestException(
        'This campaign was already published. Create a new campaign to make changes.',
      );
    }

    
    if (status === GoogleCampaignDraftStatus.PUBLISHING) {
      const updatedAt = draft.updatedAt?.getTime?.() ?? 0;
      const staleMs = 15 * 60 * 1000;
      if (Date.now() - updatedAt < staleMs) {
        throw new BadRequestException(
          'Publish is in progress. Wait for it to finish before editing this draft.',
        );
      }
      
      return draft;
    }

    if (
      !GOOGLE_DRAFT_EDITABLE_STATUSES.includes(
        status as (typeof GOOGLE_DRAFT_EDITABLE_STATUSES)[number],
      )
    ) {
      throw new BadRequestException(
        `This draft cannot be edited while status is ${draft.status}.`,
      );
    }

    return draft;
  }

  private async assertBusinessAccess(
    user: User,
    businessId: number,
    action: GoogleCampaignAccessAction = 'create',
  ): Promise<void> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      googleCampaignPermissionKeysFor(action),
      'You do not have permission to access Google campaigns for this business.',
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
  }

  private mergeCompletedSteps(
    existing: number[] | null | undefined,
    next: number[],
  ): number[] {
    return [...new Set([...(existing ?? []), ...next])].sort((a, b) => a - b);
  }

  private toCampaignInfoStepResponse(
    draft: GoogleCampaignDraft,
  ): SaveGoogleCampaignInfoStepResponseDto {
    const data = draft.draftData;
    const response: SaveGoogleCampaignInfoStepResponseDto = {
      id: draft.id,
      businessId: draft.businessId,
      currentStep: draft.currentStep,
      completedSteps: draft.completedSteps ?? [],
      version: draft.version ?? 1,
      lastSavedAt: draft.lastSavedAt,
      campaignName: draft.campaignName || data?.campaignName || '',
      businessName: draft.businessName || data?.businessName || '',
    };

    if (data?.websiteUrl?.trim()) response.websiteUrl = data.websiteUrl.trim();
    if (data?.businessCategory?.trim()) {
      response.businessCategory = data.businessCategory.trim();
    }
    if (data?.logoFileName?.trim()) {
      response.logoFileName = data.logoFileName.trim();
    }
    if (data?.logoPreviewUrl?.trim()) {
      response.logoPreviewUrl = data.logoPreviewUrl.trim();
    }

    return response;
  }

  private toGoalStepResponse(
    draft: GoogleCampaignDraft,
  ): SaveGoogleGoalStepResponseDto {
    return {
      id: draft.id,
      businessId: draft.businessId,
      goal: draft.goal!,
      campaignName: draft.campaignName,
      currentStep: draft.currentStep,
      completedSteps: draft.completedSteps ?? [],
      version: draft.version ?? 1,
      lastSavedAt: draft.lastSavedAt,
    };
  }

  private toGoalDetailsStepResponse(
    draft: GoogleCampaignDraft,
  ): SaveGoogleGoalDetailsStepResponseDto {
    const data = draft.draftData;
    const goal = draft.goal!;
    const response: SaveGoogleGoalDetailsStepResponseDto = {
      id: draft.id,
      businessId: draft.businessId,
      goal,
      currentStep: draft.currentStep,
      completedSteps: draft.completedSteps ?? [],
      version: draft.version ?? 1,
      lastSavedAt: draft.lastSavedAt,
      campaignName: draft.campaignName,
    };

    if (goal === 'SALES') {
      if (data?.salesChannel) response.salesChannel = data.salesChannel;
      if (data?.websiteUrl?.trim()) response.websiteUrl = data.websiteUrl.trim();
      if (data?.businessLocation?.trim()) {
        response.businessLocation = data.businessLocation.trim();
      }
      if (data?.businessPhone?.trim()) {
        response.businessPhone = data.businessPhone.trim();
      }
    }

    if (goal === 'LEADS') {
      if (data?.leadContactMethods?.length) {
        response.leadContactMethods = data.leadContactMethods;
      }
      if (data?.landingPageUrl?.trim()) {
        response.landingPageUrl = data.landingPageUrl.trim();
      }
      if (data?.websiteUrl?.trim()) response.websiteUrl = data.websiteUrl.trim();
      if (data?.businessPhone?.trim()) {
        response.businessPhone = data.businessPhone.trim();
      }
    }

    if (goal === 'WEBSITE_TRAFFIC') {
      if (data?.websiteUrl?.trim()) response.websiteUrl = data.websiteUrl.trim();
      if (data?.trafficAction) response.trafficAction = data.trafficAction;
    }

    if (data?.destinationType) {
      response.destinationType = data.destinationType;
    }
    if (data?.selectedFunnelId != null) {
      response.selectedFunnelId = data.selectedFunnelId;
    }
    if (data?.selectedFunnelName?.trim()) {
      response.selectedFunnelName = data.selectedFunnelName.trim();
    }
    if (data?.landingPageUrl?.trim() && !response.landingPageUrl) {
      response.landingPageUrl = data.landingPageUrl.trim();
    }

    if (goal === 'AWARENESS') {
      if (data?.businessName?.trim()) {
        response.businessName = data.businessName.trim();
      }
      if (data?.businessCategory?.trim()) {
        response.businessCategory = data.businessCategory.trim();
      }
      if (data?.businessAddress?.trim()) {
        response.businessAddress = data.businessAddress.trim();
      }
      if (data?.businessPhone?.trim()) {
        response.businessPhone = data.businessPhone.trim();
      }
      if (data?.businessHours?.trim()) {
        response.businessHours = data.businessHours.trim();
      }
    }

    if (goal === 'LOCAL_VISITS') {
      if (data?.businessLocation?.trim()) {
        response.businessLocation = data.businessLocation.trim();
      }
      if (data?.businessPhone?.trim()) {
        response.businessPhone = data.businessPhone.trim();
      }
      if (data?.businessHours?.trim()) {
        response.businessHours = data.businessHours.trim();
      }
      if (data?.businessAddress?.trim()) {
        response.businessAddress = data.businessAddress.trim();
      }
    }

    if (goal === 'APP_PROMOTION' && data?.appName?.trim()) {
      response.appName = data.appName.trim();
    }

    return response;
  }
}
