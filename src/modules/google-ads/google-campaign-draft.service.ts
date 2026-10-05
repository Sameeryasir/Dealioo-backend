import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { GoogleCampaign } from '../../db/entities/google-campaign.entity';
import { GoogleCampaignDraft } from '../../db/entities/google-campaign-draft.entity';
import type { GoogleCampaignBuilderDraftData } from '../../db/entities/google-campaign-builder-draft.types';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  googleCampaignPermissionKeysFor,
  type GoogleCampaignAccessAction,
} from '../member/member.constants';
import {
  GoogleCampaignDraftListItemDto,
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
import {
  createGoogleAdsApiClient,
  createGoogleAdsCustomer,
  normalizeGoogleCustomerId,
} from './google-ads-sdk.client';
import { GoogleAdsTokenService } from './google-ads-token.service';

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
  private readonly logger = new Logger(GoogleCampaignDraftService.name);

  constructor(
    @InjectRepository(GoogleCampaignDraft)
    private readonly draftRepository: Repository<GoogleCampaignDraft>,
    @InjectRepository(GoogleCampaign)
    private readonly googleCampaignRepository: Repository<GoogleCampaign>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly businessAccessService: BusinessAccessService,
    private readonly googleAdsTokenService: GoogleAdsTokenService,
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
      networkSelection: Array.isArray(dto.networkSelection)
        ? [
            ...new Set(
              dto.networkSelection
                .map((row) => row.trim())
                .filter(Boolean)
                .concat(['Google Search']),
            ),
          ]
        : base.networkSelection,
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

  async listDrafts(
    user: User,
    businessId: number,
  ): Promise<GoogleCampaignDraftListItemDto[]> {
    await this.assertBusinessAccess(user, businessId, 'view');

    const drafts = await this.draftRepository.find({
      where: {
        businessId,
        userId: user.id,
      },
      order: { updatedAt: 'DESC' },
    });

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });

    const synced = business
      ? await this.syncPublishedDraftsWithGoogle(business, drafts)
      : drafts;

    return synced.map((draft) => ({
      id: draft.id,
      businessId: draft.businessId,
      status: draft.status,
      currentStep: draft.currentStep,
      completedSteps: draft.completedSteps ?? [],
      version: draft.version ?? 1,
      lastSavedAt: draft.lastSavedAt,
      campaignName: draft.campaignName,
      goal: draft.goal,
      publishStatus: draft.publishStatus ?? null,
      publishStep: draft.publishStep ?? null,
      publishProgress: draft.publishProgress ?? null,
      errorMessage: draft.errorMessage ?? null,
      updatedAt: draft.updatedAt,
      logoPreviewUrl: draft.draftData?.logoPreviewUrl?.trim() || null,
      selectedFunnelName: draft.draftData?.selectedFunnelName?.trim() || null,
      selectedFunnelId:
        typeof draft.draftData?.selectedFunnelId === 'number'
          ? draft.draftData.selectedFunnelId
          : null,
      googleCampaignId: draft.googleCampaignId?.trim() || null,
      landingPageUrl: draft.draftData?.landingPageUrl?.trim() || null,
    }));
  }

  private async syncPublishedDraftsWithGoogle(
    business: Business,
    drafts: GoogleCampaignDraft[],
  ): Promise<GoogleCampaignDraft[]> {
    const published = drafts.filter((draft) => {
      const status = (draft.status ?? '').toUpperCase();
      const publishStatus = (draft.publishStatus ?? '').toUpperCase();
      return (
        Boolean(draft.googleCampaignId?.trim()) &&
        (status === GoogleCampaignDraftStatus.PUBLISHED ||
          publishStatus === 'PUBLISHED' ||
          Boolean(draft.googleAdId))
      );
    });

    if (published.length === 0) {
      return drafts;
    }

    let liveIds: Set<string>;
    try {
      liveIds = await this.fetchLiveGoogleCampaignIds(business);
    } catch (err) {
      this.logger.warn(
        `Could not sync Google campaigns for business ${business.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return drafts;
    }

    const missing = published.filter(
      (draft) => !liveIds.has(String(draft.googleCampaignId).trim()),
    );
    if (missing.length === 0) {
      return drafts;
    }

    const missingIds = missing.map((draft) => draft.id);
    const missingGoogleIds = missing
      .map((draft) => draft.googleCampaignId?.trim())
      .filter((id): id is string => Boolean(id));

    await this.draftRepository.delete({ id: In(missingIds) });
    if (missingGoogleIds.length > 0) {
      await this.googleCampaignRepository.delete({
        businessId: business.id,
        googleCampaignId: In(missingGoogleIds),
      });
    }

    this.logger.log(
      `Synced Google campaigns for business ${business.id}: removed ${missing.length} deleted campaign(s).`,
    );

    const removed = new Set(missingIds);
    return drafts.filter((draft) => !removed.has(draft.id));
  }

  private async fetchLiveGoogleCampaignIds(
    business: Business,
  ): Promise<Set<string>> {
    const credentials =
      await this.googleAdsTokenService.assertBusinessGoogleCredentials(business);
    const customerId = normalizeGoogleCustomerId(credentials.customerId ?? '');
    const loginCustomerId = normalizeGoogleCustomerId(
      credentials.loginCustomerId || customerId,
    );
    if (!customerId) {
      return new Set();
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

    const query = `
      SELECT campaign.id, campaign.status
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `.trim();

    type Row = {
      campaign?: { id?: string | number; status?: string | number };
    };

    const rows = (await customer.query(query)) as Row[];
    const live = new Set<string>();
    for (const row of rows) {
      const id = String(row.campaign?.id ?? '').replace(/\D/g, '');
      if (id) live.add(id);
    }
    return live;
  }

  async importLiveCampaignForBuilder(
    user: User,
    businessId: number,
    googleCampaignId: string,
  ): Promise<GoogleCampaignDraftResumeResponseDto> {
    const campaignId = String(googleCampaignId ?? '').replace(/\D/g, '');
    if (!campaignId) {
      throw new BadRequestException('Google campaign id is required.');
    }

    await this.assertBusinessAccess(user, businessId, 'create');

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const credentials =
      await this.googleAdsTokenService.assertBusinessGoogleCredentials(business);
    const customerId = normalizeGoogleCustomerId(credentials.customerId ?? '');
    const loginCustomerId = normalizeGoogleCustomerId(
      credentials.loginCustomerId || customerId,
    );
    if (!customerId) {
      throw new BadRequestException(
        'No Google Ads account selected. Choose a customer in Settings → Integrations.',
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

    type CampaignRow = {
      campaign?: {
        id?: string | number;
        name?: string;
        status?: string | number;
        advertising_channel_type?: string | number;
        advertisingChannelType?: string | number;
      };
      campaign_budget?: {
        id?: string | number;
        amount_micros?: string | number;
      };
      campaignBudget?: {
        id?: string | number;
        amount_micros?: string | number;
      };
    };

    const campaignRows = (await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.id,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.id = ${campaignId}
        AND campaign.status != 'REMOVED'
      LIMIT 1
    `)) as CampaignRow[];

    const campaignRow = campaignRows[0];
    if (!campaignRow?.campaign?.id) {
      throw new BadRequestException(
        'Google campaign was not found in the linked Ads account.',
      );
    }

    const budget =
      campaignRow.campaign_budget ?? campaignRow.campaignBudget ?? null;
    const budgetId = String(budget?.id ?? '').replace(/\D/g, '') || null;
    const amountMicros = Number(budget?.amount_micros ?? 0);
    const dailyBudget =
      Number.isFinite(amountMicros) && amountMicros > 0
        ? Math.round((amountMicros / 1_000_000) * 100) / 100
        : 40;

    type AdGroupRow = {
      ad_group?: { id?: string | number; name?: string };
      adGroup?: { id?: string | number; name?: string };
    };
    const adGroupRows = (await customer.query(`
      SELECT ad_group.id, ad_group.name
      FROM ad_group
      WHERE campaign.id = ${campaignId}
        AND ad_group.status != 'REMOVED'
      LIMIT 1
    `)) as AdGroupRow[];
    const adGroup = adGroupRows[0]?.ad_group ?? adGroupRows[0]?.adGroup;
    const adGroupId = String(adGroup?.id ?? '').replace(/\D/g, '') || null;

    type AdRow = {
      ad_group_ad?: {
        ad?: {
          id?: string | number;
          final_urls?: string[];
          finalUrls?: string[];
          responsive_search_ad?: {
            headlines?: Array<{ text?: string }>;
            descriptions?: Array<{ text?: string }>;
            path1?: string;
            path2?: string;
          };
          responsiveSearchAd?: {
            headlines?: Array<{ text?: string }>;
            descriptions?: Array<{ text?: string }>;
            path1?: string;
            path2?: string;
          };
        };
      };
      adGroupAd?: {
        ad?: {
          id?: string | number;
          final_urls?: string[];
          finalUrls?: string[];
          responsive_search_ad?: {
            headlines?: Array<{ text?: string }>;
            descriptions?: Array<{ text?: string }>;
            path1?: string;
            path2?: string;
          };
          responsiveSearchAd?: {
            headlines?: Array<{ text?: string }>;
            descriptions?: Array<{ text?: string }>;
            path1?: string;
            path2?: string;
          };
        };
      };
    };

    let adId: string | null = null;
    let headlines: string[] = ['', '', ''];
    let descriptions: string[] = ['', ''];
    let path1 = '';
    let path2 = '';
    let finalUrl = '';

    if (adGroupId) {
      const adRows = (await customer.query(`
        SELECT
          ad_group_ad.ad.id,
          ad_group_ad.ad.final_urls,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.responsive_search_ad.descriptions,
          ad_group_ad.ad.responsive_search_ad.path1,
          ad_group_ad.ad.responsive_search_ad.path2
        FROM ad_group_ad
        WHERE ad_group.id = ${adGroupId}
          AND ad_group_ad.status != 'REMOVED'
          AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
        LIMIT 1
      `)) as AdRow[];

      const ad =
        adRows[0]?.ad_group_ad?.ad ?? adRows[0]?.adGroupAd?.ad ?? null;
      if (ad?.id) {
        adId = String(ad.id).replace(/\D/g, '') || null;
        const rsa = ad.responsive_search_ad ?? ad.responsiveSearchAd;
        const h = (rsa?.headlines ?? [])
          .map((row) => row.text?.trim() || '')
          .filter(Boolean);
        const d = (rsa?.descriptions ?? [])
          .map((row) => row.text?.trim() || '')
          .filter(Boolean);
        headlines = h.length >= 3 ? h.slice(0, 15) : [...h, '', '', ''].slice(0, 3);
        descriptions =
          d.length >= 2 ? d.slice(0, 4) : [...d, '', ''].slice(0, 2);
        path1 = rsa?.path1?.trim() || '';
        path2 = rsa?.path2?.trim() || '';
        const urls = ad.final_urls ?? ad.finalUrls ?? [];
        finalUrl = urls[0]?.trim() || '';
      }
    }

    type KeywordRow = {
      ad_group_criterion?: {
        criterion_id?: string | number;
        keyword?: { text?: string; match_type?: string | number };
        negative?: boolean;
      };
      adGroupCriterion?: {
        criterion_id?: string | number;
        keyword?: { text?: string; match_type?: string | number };
        negative?: boolean;
      };
    };

    const keywordIds: string[] = [];
    const suggestedKeywords: Array<{
      id: string;
      text: string;
      enabled: boolean;
    }> = [];
    const negativeKeywords: string[] = [];
    let keywordMatchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'BROAD';

    if (adGroupId) {
      const keywordRows = (await customer.query(`
        SELECT
          ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.negative
        FROM ad_group_criterion
        WHERE ad_group.id = ${adGroupId}
          AND ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.status != 'REMOVED'
        LIMIT 100
      `)) as KeywordRow[];

      for (const row of keywordRows) {
        const criterion = row.ad_group_criterion ?? row.adGroupCriterion;
        const text = criterion?.keyword?.text?.trim();
        if (!text) continue;
        const criterionId = String(criterion?.criterion_id ?? '').replace(
          /\D/g,
          '',
        );
        if (criterionId) keywordIds.push(criterionId);
        if (criterion?.negative) {
          negativeKeywords.push(text);
          continue;
        }
        const matchRaw = String(criterion?.keyword?.match_type ?? 'BROAD')
          .toUpperCase()
          .replace(/\W/g, '');
        const matchType =
          matchRaw.includes('EXACT') || matchRaw === '4'
            ? ('EXACT' as const)
            : matchRaw.includes('PHRASE') || matchRaw === '3'
              ? ('PHRASE' as const)
              : ('BROAD' as const);
        if (suggestedKeywords.length === 0) {
          keywordMatchType = matchType;
        }
        suggestedKeywords.push({
          id: criterionId || `kw_${suggestedKeywords.length + 1}`,
          text,
          enabled: true,
        });
      }
    }

    const channelRaw = String(
      campaignRow.campaign.advertising_channel_type ??
        campaignRow.campaign.advertisingChannelType ??
        'SEARCH',
    ).toUpperCase();
    const campaignType =
      channelRaw.includes('DISPLAY') || channelRaw === '2'
        ? ('DISPLAY' as const)
        : channelRaw.includes('PERFORMANCE') || channelRaw === '10'
          ? ('PERFORMANCE_MAX' as const)
          : ('SEARCH' as const);

    const campaignName =
      campaignRow.campaign.name?.trim() || `Imported Google campaign ${campaignId}`;

    const draftData: GoogleCampaignBuilderDraftData = {
      ...createDefaultGoogleCampaignDraftData(),
      goal: 'WEBSITE_TRAFFIC',
      destinationType: 'external_website',
      landingPageUrl: finalUrl,
      campaignName,
      businessName: business.name?.trim() || '',
      websiteUrl: finalUrl,
      dailyBudget,
      campaignType,
      suggestedKeywords,
      negativeKeywords,
      keywordMatchType,
      ads: [
        {
          id: `ad_${Date.now()}`,
          finalUrl: finalUrl || '',
          headlines,
          descriptions,
          path1,
          path2,
          callToAction: 'LEARN_MORE',
        },
      ],
      adsGenerated: headlines.some((h) => h.trim().length > 0),
      currentStep: 8,
      onboardingDone: true,
    };

    const completedSteps = [1, 2, 3, 4, 5, 6, 7];
    const now = new Date();

    const existing = await this.draftRepository.findOne({
      where: {
        businessId,
        userId: user.id,
        googleCampaignId: campaignId,
      },
    });

    let saved: GoogleCampaignDraft;
    if (existing) {
      existing.draftData = draftData;
      existing.campaignName = campaignName;
      existing.goal = 'WEBSITE_TRAFFIC';
      existing.campaignType = campaignType;
      existing.businessName = business.name?.trim() || existing.businessName;
      existing.dailyBudget = String(dailyBudget);
      existing.googleCampaignId = campaignId;
      existing.googleBudgetId = budgetId;
      existing.googleAdGroupId = adGroupId;
      existing.googleAdId = adId;
      existing.googleKeywordIds = keywordIds.length > 0 ? keywordIds : null;
      existing.currentStep = 8;
      existing.completedSteps = completedSteps;
      existing.status = GoogleCampaignDraftStatus.DRAFT;
      existing.errorMessage = null;
      existing.publishStatus = null;
      existing.publishJobId = null;
      existing.publishStep = null;
      existing.publishProgress = 0;
      existing.lastSavedAt = now;
      existing.updatedBy = user.id;
      existing.version = (existing.version ?? 1) + 1;
      saved = await this.draftRepository.save(existing);
    } else {
      saved = await this.draftRepository.save({
        userId: user.id,
        businessId,
        createdBy: user.id,
        updatedBy: user.id,
        currentStep: 8,
        status: GoogleCampaignDraftStatus.DRAFT,
        draftData,
        campaignName,
        goal: 'WEBSITE_TRAFFIC',
        campaignType,
        businessName: business.name?.trim() || null,
        dailyBudget: String(dailyBudget),
        googleCampaignId: campaignId,
        googleBudgetId: budgetId,
        googleAdGroupId: adGroupId,
        googleAdId: adId,
        googleKeywordIds: keywordIds.length > 0 ? keywordIds : null,
        completedSteps,
        lastSavedAt: now,
        version: 1,
      });
    }

    const [tracking] = await this.googleCampaignRepository.find({
      where: { businessId, googleCampaignId: campaignId },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    if (tracking) {
      await this.googleCampaignRepository.update(tracking.id, {
        draftId: saved.id,
        googleBudgetId: budgetId ?? tracking.googleBudgetId,
        googleAdGroupId: adGroupId ?? tracking.googleAdGroupId,
        googleAdId: adId ?? tracking.googleAdId,
        googleKeywordIds:
          keywordIds.length > 0 ? keywordIds : tracking.googleKeywordIds,
        campaignName,
        budget: String(dailyBudget),
      });
    } else {
      await this.googleCampaignRepository.save({
        userId: user.id,
        businessId,
        draftId: saved.id,
        customerId,
        googleCampaignId: campaignId,
        googleBudgetId: budgetId,
        googleAdGroupId: adGroupId,
        googleAdId: adId,
        googleKeywordIds: keywordIds.length > 0 ? keywordIds : null,
        campaignName,
        goal: 'WEBSITE_TRAFFIC',
        campaignType,
        budget: String(dailyBudget),
        status: 'PAUSED',
      });
    }

    this.logger.log(
      `Imported Google campaign ${campaignId} into draft ${saved.id} for business ${businessId}`,
    );

    return {
      id: saved.id,
      businessId: saved.businessId,
      status: saved.status,
      currentStep: saved.currentStep,
      completedSteps: saved.completedSteps ?? [],
      version: saved.version ?? 1,
      lastSavedAt: saved.lastSavedAt,
      campaignName: saved.campaignName,
      goal: saved.goal,
      draftData: saved.draftData,
      publishStatus: saved.publishStatus ?? null,
      publishStep: saved.publishStep ?? null,
      publishProgress: saved.publishProgress ?? null,
      errorMessage: saved.errorMessage ?? null,
      updatedAt: saved.updatedAt ?? null,
    };
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
      updatedAt: draft.updatedAt ?? null,
    };
  }

  async deleteDraft(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<{ deleted: true; draftId: string }> {
    await this.assertBusinessAccess(user, businessId, 'create');

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

    const status = (draft.status ?? '').toUpperCase();
    const publishStatus = (draft.publishStatus ?? '').toUpperCase();
    const isPublishing =
      status === GoogleCampaignDraftStatus.PUBLISHING ||
      status === GoogleCampaignDraftStatus.VALIDATING ||
      publishStatus === 'QUEUED' ||
      publishStatus === 'PUBLISHING';
    const isPublished =
      status === GoogleCampaignDraftStatus.PUBLISHED ||
      publishStatus === 'PUBLISHED' ||
      Boolean(draft.googleCampaignId && draft.googleAdId);

    if (isPublishing) {
      throw new BadRequestException(
        'This campaign is publishing. Wait for it to finish before deleting.',
      );
    }

    if (isPublished) {
      throw new BadRequestException(
        'Published campaigns cannot be deleted here. Delete them from Google Ads instead.',
      );
    }

    await this.googleCampaignRepository.delete({
      businessId,
      draftId: draft.id,
    });
    await this.draftRepository.remove(draft);

    return { deleted: true, draftId: draft.id };
  }

  async duplicateDraft(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<GoogleCampaignDraftListItemDto> {
    await this.assertBusinessAccess(user, businessId, 'create');

    const source = await this.draftRepository.findOne({
      where: {
        id: draftId.trim(),
        businessId,
        userId: user.id,
      },
    });

    if (!source) {
      throw new NotFoundException('Google campaign draft not found.');
    }

    const status = (source.status ?? '').toUpperCase();
    const publishStatus = (source.publishStatus ?? '').toUpperCase();
    const isPublishing =
      status === GoogleCampaignDraftStatus.PUBLISHING ||
      status === GoogleCampaignDraftStatus.VALIDATING ||
      publishStatus === 'QUEUED' ||
      publishStatus === 'PUBLISHING';

    if (isPublishing) {
      throw new BadRequestException(
        'This campaign is publishing. Wait for it to finish before duplicating.',
      );
    }

    if (!source.draftData) {
      throw new BadRequestException(
        'This campaign has no saved setup to duplicate yet.',
      );
    }

    const baseName = (source.campaignName ?? source.draftData.campaignName ?? 'Campaign')
      .trim()
      .replace(/\s*\(Copy(?:\s+\d+)?\)\s*$/i, '');
    const copyName = `${baseName || 'Campaign'} (Copy)`.slice(0, 255);

    const clonedData = JSON.parse(
      JSON.stringify(source.draftData),
    ) as typeof source.draftData;
    clonedData.campaignName = copyName;

    const now = new Date();
    const created = this.draftRepository.create({
      userId: user.id,
      businessId,
      createdBy: user.id,
      updatedBy: user.id,
      currentStep: source.currentStep || 1,
      status: GoogleCampaignDraftStatus.DRAFT,
      draftData: clonedData,
      campaignName: copyName,
      goal: source.goal,
      campaignType: source.campaignType,
      businessName: source.businessName,
      dailyBudget: source.dailyBudget,
      googleCampaignId: null,
      googleBudgetId: null,
      googleAdGroupId: null,
      googleAdId: null,
      googleKeywordIds: null,
      errorMessage: null,
      version: 1,
      completedSteps: [...(source.completedSteps ?? [])],
      lastSavedAt: now,
      publishStatus: null,
      publishJobId: null,
      publishStep: null,
      publishProgress: 0,
      publishedAt: null,
      lastIdempotencyKey: null,
      lastIdempotencyResponse: null,
    });

    const saved = await this.draftRepository.save(created);

    return {
      id: saved.id,
      businessId: saved.businessId,
      status: saved.status,
      currentStep: saved.currentStep,
      completedSteps: saved.completedSteps ?? [],
      version: saved.version ?? 1,
      lastSavedAt: saved.lastSavedAt,
      campaignName: saved.campaignName,
      goal: saved.goal,
      publishStatus: saved.publishStatus ?? null,
      publishStep: saved.publishStep ?? null,
      publishProgress: saved.publishProgress ?? null,
      errorMessage: saved.errorMessage ?? null,
      updatedAt: saved.updatedAt,
      logoPreviewUrl: saved.draftData?.logoPreviewUrl?.trim() || null,
      selectedFunnelName: saved.draftData?.selectedFunnelName?.trim() || null,
      selectedFunnelId:
        typeof saved.draftData?.selectedFunnelId === 'number'
          ? saved.draftData.selectedFunnelId
          : null,
      googleCampaignId: null,
      landingPageUrl: saved.draftData?.landingPageUrl?.trim() || null,
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
        containsEuPoliticalAdvertising:
          typeof dto.containsEuPoliticalAdvertising === 'boolean'
            ? dto.containsEuPoliticalAdvertising
            : base.containsEuPoliticalAdvertising,
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

    const resolvedSuggested =
      enabledCount > 0
        ? suggested
        : [
            {
              id: `kw_fallback_${Date.now()}`,
              text:
                dto.businessType?.trim() ||
                dto.productsServices?.find((row) => row.trim())?.trim() ||
                'local business',
              enabled: true,
            },
          ];

    return this.commitWizardStep(user, businessId, dto.draftId, {
      expectedVersion: dto.expectedVersion,
      completedStep: 8,
      nextStep: 9,
      apply: (base) => ({
        ...base,
        businessType: dto.businessType.trim(),
        suggestedKeywords: resolvedSuggested,
        customKeywords: enabledCount > 0 ? custom : [],
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
      completedStep: 7,
      nextStep: 8,
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
    const funnelGoals =
      goal === 'SALES' || goal === 'LEADS' || goal === 'WEBSITE_TRAFFIC';

    if (funnelGoals) {
      if (dto.destinationType && dto.destinationType !== 'dealioo_funnel') {
        throw new BadRequestException(
          'Google campaigns must send traffic to a Dealioo funnel.',
        );
      }
      if (!this.isValidHttpUrl(dto.landingPageUrl || dto.websiteUrl)) {
        throw new BadRequestException(
          'Select a published Dealioo funnel with a valid link.',
        );
      }
    }

    if (goal === 'SALES' && !dto.salesChannel) {
      throw new BadRequestException('Choose how customers buy from you.');
    }

    if (goal === 'LEADS') {
      const methods = (dto.leadContactMethods ?? []).filter(
        (id) => id !== 'WHATSAPP' && id !== 'APPOINTMENT_BOOKING',
      );
      const primary = methods[0] ?? null;
      if (!primary || methods.length !== 1) {
        throw new BadRequestException('Choose one primary lead method.');
      }
      if (primary !== 'CONTACT_FORM') {
        throw new BadRequestException(
          'Leads campaigns must use a Dealioo funnel form destination.',
        );
      }
    }

    if (goal === 'WEBSITE_TRAFFIC' && !dto.trafficAction) {
      throw new BadRequestException('Choose an action for visitors.');
    }

    if (goal === 'LOCAL_VISITS' || goal === 'APP_PROMOTION') {
      throw new BadRequestException(
        'This goal is not supported. Choose Sales, Leads, or Website Traffic to send people to a Dealioo funnel.',
      );
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
