import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { GoogleCampaignDraft } from '../../db/entities/google-campaign-draft.entity';
import type { GoogleCampaignBuilderDraftData } from '../../db/entities/google-campaign-builder-draft.types';
import { User } from '../../db/entities/user.entity';
import { BusinessService } from '../business/business.service';
import {
  GoogleCampaignDraftResumeResponseDto,
  SaveGoogleCampaignInfoStepResponseDto,
  SaveGoogleGoalDetailsStepResponseDto,
  SaveGoogleGoalStepResponseDto,
} from './dto/google-campaign-draft-response.dto';
import { PublishGoogleCampaignDraftDto } from './dto/publish-google-campaign-draft.dto';
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
  generateGoogleCampaignName,
} from './google-campaign-draft-defaults';
import { assertPublishValidation } from './google-campaign-draft-validation';

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
    private readonly businessService: BusinessService,
  ) {}

  // --- Step 1: Marketing goal ---
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

    // --- Update existing draft (OCC required) ---
    if (dto.draftId?.trim()) {
      if (dto.expectedVersion == null) {
        throw new BadRequestException(
          'expectedVersion is required when updating a draft.',
        );
      }

      const existing = await this.findEditableDraft(
        user.id,
        businessId,
        dto.draftId.trim(),
      );

      const cached =
        this.getCachedIdempotentResponse<SaveGoogleGoalStepResponseDto>(
          existing,
          idempotencyKey,
        );
      if (cached) return cached;

      const draftData = this.applyGoalToDraftData(
        existing.draftData ?? createDefaultGoogleCampaignDraftData(),
        dto.goal,
        existing.businessName ?? existing.draftData?.businessName,
      );

      return this.dataSource.transaction(async (manager) => {
        const saved = await this.updateDraftWithOcc(manager, {
          draft: existing,
          expectedVersion: dto.expectedVersion!,
          userId: user.id,
          businessId,
          now,
          fields: {
            draftData,
            goal: dto.goal,
            campaignName: draftData.campaignName,
            campaignType: draftData.campaignType,
            businessName: draftData.businessName || existing.businessName,
            dailyBudget:
              draftData.dailyBudget != null
                ? String(draftData.dailyBudget)
                : null,
            currentStep: Math.max(existing.currentStep, 2),
            // Backend owns completed_steps — never accept from client
            completedSteps: this.mergeCompletedSteps(existing.completedSteps, [
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

    // --- Create path: no OCC, version starts at 1 ---
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

      // Store idempotency cache on create when a key was provided
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

  // --- Step 2: Goal details ---
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
      businessPhone,
      phoneNumber: businessPhone || base.phoneNumber,
      leadContactMethods: dto.leadContactMethods ?? base.leadContactMethods,
      landingPageUrl: landingPageUrl || websiteUrl,
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

    if (dto.businessName?.trim()) {
      draftData.campaignName = generateGoogleCampaignName(
        goal,
        dto.businessName.trim(),
      );
    }

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

  // --- Step 3: Campaign info ---
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

    return {
      id: draft.id,
      businessId: draft.businessId,
      // Return status as stored (uppercase DRAFT / PUBLISHING / etc.)
      status: draft.status,
      currentStep: draft.currentStep,
      completedSteps: draft.completedSteps ?? [],
      version: draft.version ?? 1,
      lastSavedAt: draft.lastSavedAt,
      campaignName: draft.campaignName,
      goal: draft.goal,
      draftData: draft.draftData,
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

  // --- Publish (stub queue — no real Google Ads API yet) ---
  async publishDraft(
    user: User,
    businessId: number,
    dto: PublishGoogleCampaignDraftDto,
  ): Promise<{
    draftId: string;
    status: string;
    version: number;
    message: string;
  }> {
    await this.assertBusinessAccess(user, businessId);

    const draft = await this.findEditableDraft(
      user.id,
      businessId,
      dto.draftId.trim(),
    );

    // Full draft validation before any status change
    assertPublishValidation(draft.draftData);

    const now = new Date();
    const publishJobId = randomUUID();

    return this.dataSource.transaction(async (manager) => {
      // Mark VALIDATING under OCC, then move to PUBLISHING with a stub job id
      await this.updateDraftWithOcc(manager, {
        draft,
        expectedVersion: dto.expectedVersion,
        userId: user.id,
        businessId,
        now,
        fields: {
          status: GoogleCampaignDraftStatus.VALIDATING,
          updatedBy: user.id,
          errorMessage: null,
        },
        mapResponse: (row) => row,
      });

      const validating = await manager.findOne(GoogleCampaignDraft, {
        where: {
          id: draft.id,
          businessId,
          userId: user.id,
        },
      });

      if (!validating) {
        throw new NotFoundException('Google campaign draft not found.');
      }

      // NOTE: Queue stub only — real Google Ads publish job comes later
      const published = await this.updateDraftWithOcc(manager, {
        draft: validating,
        expectedVersion: validating.version,
        userId: user.id,
        businessId,
        now,
        fields: {
          status: GoogleCampaignDraftStatus.PUBLISHING,
          publishStatus: GoogleCampaignDraftStatus.PUBLISHING,
          publishJobId,
          publishProgress: 0,
          publishStep: 'queued',
          updatedBy: user.id,
        },
        mapResponse: (row) => row,
      });

      return {
        draftId: published.id,
        status: published.status,
        version: published.version ?? 1,
        message:
          'Publish job queued. Google Ads API create is not wired yet (stub).',
      };
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
    if (dto.radiusEnabled && (!dto.radiusValue || dto.radiusValue < 1)) {
      throw new BadRequestException('Enter a radius of at least 1.');
    }

    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 5,
      nextStep: 6,
      apply: (base) => ({
        ...base,
        targetLocations: dto.targetLocations,
        excludedLocationTargets:
          dto.excludedLocationTargets ?? base.excludedLocationTargets,
        countries: dto.countries ?? base.countries,
        regions: dto.regions ?? base.regions,
        cities: dto.cities ?? base.cities,
        excludedLocations: dto.excludedLocations ?? base.excludedLocations,
        radiusEnabled: dto.radiusEnabled ?? base.radiusEnabled,
        radiusCenter:
          dto.radiusCenter === undefined
            ? base.radiusCenter
            : dto.radiusCenter,
        radiusLat: dto.radiusLat === undefined ? base.radiusLat : dto.radiusLat,
        radiusLng: dto.radiusLng === undefined ? base.radiusLng : dto.radiusLng,
        radiusValue: dto.radiusValue ?? base.radiusValue,
        radiusUnit: dto.radiusUnit ?? base.radiusUnit,
        radiusTargeting: dto.radiusTargeting ?? base.radiusTargeting,
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

  // --- Shared wizard step commit (OCC + transaction + optional idempotency) ---
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
      // Backend-owned merge: steps 1..completedStep
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

  /**
   * Optimistic concurrency update inside an open transaction.
   * WHERE id + version + ownership; bump version atomically.
   */
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
      // Atomic version bump — never trust client version for the new value
      version: () => '"version" + 1',
      updatedAt: now,
      updatedBy: fields.updatedBy ?? userId,
    };

    if (idempotencyKey?.trim()) {
      // Placeholder; real response cached after reload below
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

    // Persist idempotent response for safe client retries
    if (idempotencyKey?.trim()) {
      await manager
        .createQueryBuilder()
        .update(GoogleCampaignDraft)
        .set({
          lastIdempotencyKey: idempotencyKey.trim(),
          // TypeORM jsonb set typing rejects Record<string, unknown> without cast
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
      if (!dto.leadContactMethods?.length) {
        throw new BadRequestException(
          'Select at least one contact method.',
        );
      }
      if (
        dto.leadContactMethods.includes('CONTACT_FORM') &&
        !this.isValidHttpUrl(dto.landingPageUrl || dto.websiteUrl)
      ) {
        throw new BadRequestException('Add a landing page URL.');
      }
      if (
        dto.leadContactMethods.includes('PHONE_CALLS') &&
        !dto.businessPhone?.trim()
      ) {
        throw new BadRequestException('Add a business phone number.');
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
      if (!dto.businessCategory?.trim()) {
        throw new BadRequestException('Choose a business category.');
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
      campaignName: generateGoogleCampaignName(goal, name),
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

    // PUBLISHED always blocks further edits
    if (status === GoogleCampaignDraftStatus.PUBLISHED) {
      throw new BadRequestException(
        'This campaign was already published. Create a new campaign to make changes.',
      );
    }

    // PUBLISHING blocks only while the job is still considered active
    if (status === GoogleCampaignDraftStatus.PUBLISHING) {
      const updatedAt = draft.updatedAt?.getTime?.() ?? 0;
      const staleMs = 15 * 60 * 1000;
      if (Date.now() - updatedAt < staleMs) {
        throw new BadRequestException(
          'Publish is in progress. Wait for it to finish before editing this draft.',
        );
      }
      // Stale PUBLISHING — allow edit; save path resets status to DRAFT
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

    if (goal === 'APP_PROMOTION' && data?.appName?.trim()) {
      response.appName = data.appName.trim();
    }

    return response;
  }
}
