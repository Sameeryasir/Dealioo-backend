import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { MetaAdCampaignStatsSnapshot } from '../../db/entities/meta-ad-campaign-stats-snapshot.entity';
import {
  MetaOAuthSession,
  MetaOAuthSessionStatus,
} from '../../db/entities/meta-oauth-session.entity';
import { User } from '../../db/entities/user.entity';
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';
import { AdminNotificationWriter } from '../admin-notifications/admin-notifications.writer';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  metaCampaignPermissionKeysFor,
  type MetaCampaignAccessAction,
} from '../member/member.constants';
import { FacebookAdAccountDto } from './dto/facebook-ad-account.dto';
import {
  FacebookAdBreakdownRowDto,
  FacebookAdCampaignDto,
  FacebookAdCampaignInsightDto,
  FacebookAdCampaignPaginationDto,
  FacebookAdCampaignStatsDto,
  FacebookAdCampaignStatsSummaryDto,
  FacebookAdDailyInsightDto,
  FacebookAdInsightBreakdownsDto,
} from './dto/facebook-ad-campaign-stats.dto';
import { FacebookAdPixelDto } from './dto/facebook-ad-pixel.dto';
import { FacebookConnectionStatusDto } from './dto/facebook-connection-status.dto';
import { FacebookPageDto } from './dto/facebook-page.dto';
import { FacebookOAuthCallbackResultDto } from './dto/facebook-oauth-callback-result.dto';
import {
  FacebookConnectionStatus,
  type FacebookConnectionStatusValue,
} from './facebook-connection-status';
import { FacebookIntegrationAuditService } from './facebook-integration-audit.service';
import { FacebookMetaTokenService } from './facebook-meta-token.service';
import {
  createFacebookOAuthState,
  parseFacebookOAuthState,
} from './facebook-oauth-state';
import {
  toFacebookOAuthScopeParam,
} from './facebook-oauth-scopes.util';
import {
  buildMetaOAuthDialogScopes,
  filterGrantedSelectableScopes,
  findMissingRequestedScopes,
  assertRequestedMetaScopesSelected,
  normalizeSelectableMetaScopes,
} from './meta-oauth-selectable-scopes';
const FACEBOOK_GRAPH = 'https://graph.facebook.com/v24.0';
const FACEBOOK_OAUTH_DIALOG = 'https://www.facebook.com/v24.0/dialog/oauth';


type FacebookTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string };
};

type FacebookMeResponse = {
  id?: string;
  name?: string;
  error?: { message?: string };
};

type FacebookAdAccountMetaResponse = {
  id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  error?: { message?: string };
};

type FacebookAdAccountsResponse = {
  data?: Array<{
    id?: string;
    account_id?: string;
    name?: string;
    account_status?: number;
    currency?: string;
    timezone_name?: string;
  }>;
  error?: { message?: string };
};

type FacebookCampaignsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    daily_budget?: string;
    insights?: {
      data?: Array<{
        spend?: string;
        impressions?: string;
        reach?: string;
        clicks?: string;
      }>;
    };
  }>;
  error?: { message?: string };
};

const META_AD_STATS_DATE_PRESET = 'last_30d';
const META_CAMPAIGN_FIELDS =
  'id,name,status,effective_status,daily_budget';
const META_CAMPAIGN_INSIGHT_FIELDS =
  'campaign_id,spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type';
const META_SINGLE_CAMPAIGN_INSIGHT_FIELDS =
  'spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type';
const GRAPH_FETCH_TIMEOUT_MS = 25_000;
const GRAPH_FETCH_RETRIES = 2;
const CAMPAIGN_STATS_DB_TTL_MS = 10 * 60_000;
const INSIGHTS_FETCH_CONCURRENCY = 4;
const DEFAULT_CAMPAIGN_PAGE_SIZE = 4;
const MAX_CAMPAIGN_PAGE_SIZE = 50;
const PRIMARY_ACTION_PRIORITY = [
  'purchase',
  'omni_purchase',
  'lead',
  'complete_registration',
  'submit_application',
  'contact',
  'schedule',
  'start_trial',
  'subscribe',
  'add_to_cart',
  'initiate_checkout',
  'link_click',
] as const;

type MetaInsightActionRow = {
  action_type?: string;
  value?: string;
};

type MetaCampaignInsightRow = {
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: MetaInsightActionRow[];
  cost_per_action_type?: MetaInsightActionRow[];
};

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly campaignStatsRefreshInFlight = new Map<
    string,
    Promise<FacebookAdCampaignStatsDto>
  >();

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(MetaOAuthSession)
    private readonly metaOAuthSessionRepository: Repository<MetaOAuthSession>,
    @InjectRepository(MetaAdCampaignStatsSnapshot)
    private readonly campaignStatsSnapshotRepository: Repository<MetaAdCampaignStatsSnapshot>,
    private readonly auditService: FacebookIntegrationAuditService,
    private readonly metaTokenService: FacebookMetaTokenService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly adminNotificationWriter: AdminNotificationWriter,
  ) {}

  private async requireMetaBusiness(
    user: User,
    businessId: number,
    action: MetaCampaignAccessAction = 'view',
  ): Promise<Business> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      metaCampaignPermissionKeysFor(action),
      'You do not have permission to access Meta for this business.',
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

  async connect(
    user: User,
    businessId: number,
    selectedScopes: string[],
  ): Promise<{ url: string; scopes: string[] }> {
    const business = await this.requireMetaBusiness(user, businessId, 'create');

    const requestedScopes = (() => {
      try {
        return assertRequestedMetaScopesSelected(selectedScopes);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error
            ? err.message
            : 'Select at least one Meta Ads permission before connecting.',
        );
      }
    })();

    await this.businessRepository.update(businessId, {
      metaConnectionStatus: FacebookConnectionStatus.INITIATED,
      metaRequestedScopes: requestedScopes.join(','),
    });

    await this.auditService.log(businessId, 'oauth_started', {
      status: FacebookConnectionStatus.INITIATED,
      metadata: { requestedScopes },
    });

    return this.createOAuthConnectUrl(business.id, requestedScopes);
  }

  async abortOAuthConnect(
    user: User,
    businessId: number,
  ): Promise<{ restored: true }> {
    const business = await this.requireMetaBusiness(user, businessId, 'create');

    if (business.metaConnectionStatus !== FacebookConnectionStatus.INITIATED) {
      return { restored: true };
    }

    const hasMetaLogin = Boolean(
      business.metaUserId?.trim() && business.metaAccessToken?.trim(),
    );

    let restoredStatus: FacebookConnectionStatusValue | null = null;

    if (hasMetaLogin && business.metaAdAccountId?.trim()) {
      restoredStatus = FacebookConnectionStatus.AD_ACCOUNT_SELECTED;
    } else if (hasMetaLogin) {
      restoredStatus = FacebookConnectionStatus.TOKEN_EXCHANGED;
    }

    await this.businessRepository.update(businessId, {
      metaConnectionStatus: restoredStatus,
    });

    await this.auditService.log(businessId, 'oauth_aborted', {
      status: restoredStatus,
    });

    return { restored: true };
  }

  async createOAuthConnectUrl(
    businessId: number,
    selectedScopes: string[],
  ): Promise<{ url: string; scopes: string[] }> {
    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });

    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const appId = this.getAppId();
    if (!appId) {
      throw new InternalServerErrorException(
        'Set FACEBOOK_APP_ID for Facebook Login OAuth.',
      );
    }

    const redirectUri = this.getRedirectUri();
    if (!redirectUri) {
      throw new InternalServerErrorException(
        'Set FACEBOOK_REDIRECT_URI to your OAuth callback URL (e.g. GET /facebook/callback/oauth).',
      );
    }

    const stateSecret = this.getStateSecret();
    if (!stateSecret) {
      throw new InternalServerErrorException(
        'Set FACEBOOK_APP_SECRET for signed OAuth state.',
      );
    }

    let requestedScopes: string[];
    try {
      requestedScopes = assertRequestedMetaScopesSelected(selectedScopes);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'Select at least one Meta Ads permission before connecting.',
      );
    }

    const dialogScopes = buildMetaOAuthDialogScopes(requestedScopes);
    const state = createFacebookOAuthState(businessId, stateSecret);

    await this.metaOAuthSessionRepository.save(
      this.metaOAuthSessionRepository.create({
        businessId,
        requestedScopes,
        oauthState: state,
        status: MetaOAuthSessionStatus.INITIATED,
      }),
    );

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      auth_type: 'rerequest',
      scope: toFacebookOAuthScopeParam(dialogScopes),
    });

    return {
      url: `${FACEBOOK_OAUTH_DIALOG}?${params.toString()}`,
      scopes: requestedScopes,
    };
  }

  async handleOAuthCallback(
    code: string | undefined,
    state: string | undefined,
    oauthError: string | undefined,
    oauthErrorDescription: string | undefined,
  ): Promise<FacebookOAuthCallbackResultDto> {
    let businessId: number | null = null;
    let oauthSession: MetaOAuthSession | null = null;

    try {
      if (oauthError) {
        throw new BadRequestException(
          oauthErrorDescription?.trim() ||
            oauthError ||
            'Facebook connection was cancelled.',
        );
      }

      if (!code?.trim()) {
        throw new BadRequestException('Missing Facebook OAuth code.');
      }

      if (!state?.trim()) {
        throw new BadRequestException('Missing Facebook OAuth state.');
      }

      const stateSecret = this.getStateSecret();
      if (!stateSecret) {
        throw new InternalServerErrorException(
          'Set FACEBOOK_APP_SECRET for signed OAuth state.',
        );
      }

      businessId = parseFacebookOAuthState(state, stateSecret);

      oauthSession = await this.metaOAuthSessionRepository.findOne({
        where: {
          oauthState: state.trim(),
          businessId,
          status: MetaOAuthSessionStatus.INITIATED,
        },
        order: { createdAt: 'DESC' },
      });

      if (!oauthSession) {
        throw new BadRequestException(
          'Meta OAuth session expired or was not found. Select permissions and try connecting again.',
        );
      }

      const business = await this.businessRepository.findOne({
        where: { id: businessId },
      });

      if (!business) {
        throw new NotFoundException('Business not found.');
      }

      const appId = this.getAppId();
      const appSecret = this.getAppSecret();
      const redirectUri = this.getRedirectUri();

      if (!appId || !appSecret || !redirectUri) {
        throw new InternalServerErrorException(
          'Set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_REDIRECT_URI.',
        );
      }

      const tokenJson = await this.exchangeCodeForAccessToken(
        code.trim(),
        appId,
        appSecret,
        redirectUri,
      );

      const shortLivedToken = tokenJson.access_token;
      if (!shortLivedToken) {
        throw new BadRequestException(
          tokenJson.error?.message ??
            'Facebook did not return an access token. Try connecting again.',
        );
      }

      const result = await this.persistExchangedUserToken(
        businessId,
        shortLivedToken,
        oauthSession.requestedScopes,
      );

      await this.metaOAuthSessionRepository.update(oauthSession.id, {
        status: MetaOAuthSessionStatus.COMPLETED,
      });

      return result;
    } catch (err) {
      if (oauthSession) {
        await this.metaOAuthSessionRepository.update(oauthSession.id, {
          status: MetaOAuthSessionStatus.FAILED,
        });
      }
      if (businessId != null) {
        await this.businessRepository.update(businessId, {
          metaUserId: null,
          metaAccessToken: null,
          metaConnectedAt: null,
          metaAdAccountId: null,
          metaConnectionStatus: FacebookConnectionStatus.FAILED,
          metaTokenExpiresAt: null,
          metaOauthScopes: null,
        });
        await this.auditService.log(businessId, 'oauth_failed', {
          status: FacebookConnectionStatus.FAILED,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        const failedBusiness = await this.businessRepository.findOne({
          where: { id: businessId },
          relations: ['owner'],
        });
        await this.adminNotificationWriter.notifyIntegrationFailed({
          provider: 'meta',
          businessId,
          businessName:
            failedBusiness?.name?.trim() || `Business #${businessId}`,
          reason: err instanceof Error ? err.message : String(err),
          actorUserId: failedBusiness?.owner?.id ?? null,
        });
      }
      throw err;
    }
  }

  async getAdCampaignStats(
    business: Business,
    options?: {
      includeInsights?: boolean;
      bypassCache?: boolean;
      page?: number;
      pageSize?: number;
      query?: string;
    },
  ): Promise<FacebookAdCampaignStatsDto> {
    const includeInsights = options?.includeInsights !== false;
    const bypassCache = options?.bypassCache === true;
    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);

    const adAccount = this.requireBusinessAdAccount(business);
    const cacheKey = `${business.id}:${adAccount.id}`;

    let full: FacebookAdCampaignStatsDto;

    if (!bypassCache) {
      const snapshot = await this.findCampaignStatsSnapshot(
        business.id,
        adAccount.id,
      );
      if (snapshot && (!includeInsights || snapshot.includeInsights)) {
        const payload = snapshot.payload as unknown as FacebookAdCampaignStatsDto;
        const missingCampaignDaily =
          includeInsights &&
          Array.isArray(payload.campaigns) &&
          payload.campaigns.some(
            (c) => !Array.isArray((c as FacebookAdCampaignDto).dailyInsights),
          );

        if (missingCampaignDaily) {
          this.logger.log(
            `Meta campaign stats cache missing dailyInsights for business ${business.id}; refreshing from Meta`,
          );
        } else {
          const ageMs = Date.now() - snapshot.fetchedAt.getTime();
          const isStale = ageMs >= CAMPAIGN_STATS_DB_TTL_MS;
          if (isStale) {
            this.scheduleCampaignStatsRefresh(
              cacheKey,
              business,
              adAccount.id,
              accessToken,
              true,
            );
          }
          full = this.statsDtoFromSnapshot(snapshot, includeInsights, {
            fromCache: true,
            isStale,
          });
          return this.withCampaignListView(full, options);
        }
      }
    }

    if (bypassCache) {
      const inFlight = this.campaignStatsRefreshInFlight.get(cacheKey);
      if (inFlight) {
        full = this.withInsightsPreference(await inFlight, includeInsights);
        return this.withCampaignListView(full, options);
      }
    }

    full = await this.refreshCampaignStatsFromMeta(
      cacheKey,
      business,
      adAccount.id,
      accessToken,
      includeInsights,
    );
    return this.withCampaignListView(full, options);
  }

  invalidateCampaignStatsCache(businessId: number): void {
    const prefix = `${businessId}:`;
    for (const key of this.campaignStatsRefreshInFlight.keys()) {
      if (key.startsWith(prefix)) {
        this.campaignStatsRefreshInFlight.delete(key);
      }
    }
    void this.campaignStatsSnapshotRepository
      .delete({ businessId })
      .catch((err) => {
        this.logger.warn(
          `Failed to clear Meta campaign stats snapshots for business ${businessId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  private scheduleCampaignStatsRefresh(
    cacheKey: string,
    business: Business,
    adAccountId: string,
    accessToken: string,
    includeInsights: boolean,
  ): void {
    if (this.campaignStatsRefreshInFlight.has(cacheKey)) return;
    void this.refreshCampaignStatsFromMeta(
      cacheKey,
      business,
      adAccountId,
      accessToken,
      includeInsights,
    ).catch((err) => {
      this.logger.warn(
        `Background Meta campaign stats refresh failed for ${cacheKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  private async refreshCampaignStatsFromMeta(
    cacheKey: string,
    business: Business,
    adAccountId: string,
    accessToken: string,
    includeInsights: boolean,
  ): Promise<FacebookAdCampaignStatsDto> {
    const existing = this.campaignStatsRefreshInFlight.get(cacheKey);
    if (existing) {
      const fresh = await existing;
      return this.withInsightsPreference(fresh, includeInsights);
    }

    const promise = this.fetchAndPersistCampaignStats(
      business,
      adAccountId,
      accessToken,
      includeInsights,
    ).finally(() => {
      if (this.campaignStatsRefreshInFlight.get(cacheKey) === promise) {
        this.campaignStatsRefreshInFlight.delete(cacheKey);
      }
    });
    this.campaignStatsRefreshInFlight.set(cacheKey, promise);
    return promise;
  }

  private async findCampaignStatsSnapshot(
    businessId: number,
    adAccountId: string,
  ): Promise<MetaAdCampaignStatsSnapshot | null> {
    try {
      return await this.campaignStatsSnapshotRepository.findOne({
        where: {
          businessId,
          adAccountId,
          datePreset: META_AD_STATS_DATE_PRESET,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Meta campaign stats snapshot read failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private statsDtoFromSnapshot(
    snapshot: MetaAdCampaignStatsSnapshot,
    includeInsights: boolean,
    flags: { fromCache: boolean; isStale: boolean },
  ): FacebookAdCampaignStatsDto {
    const payload = snapshot.payload as unknown as FacebookAdCampaignStatsDto;
    const base: FacebookAdCampaignStatsDto = {
      adAccountId: payload.adAccountId ?? snapshot.adAccountId,
      adAccountName: payload.adAccountName ?? null,
      currency: payload.currency ?? null,
      datePreset: payload.datePreset ?? snapshot.datePreset,
      campaigns: Array.isArray(payload.campaigns) ? payload.campaigns : [],
      dailyInsights: Array.isArray(payload.dailyInsights)
        ? payload.dailyInsights
        : [],
      breakdowns: payload.breakdowns ?? null,
      fetchedAt: snapshot.fetchedAt.toISOString(),
      fromCache: flags.fromCache,
      isStale: flags.isStale,
      summary: null,
      pagination: null,
    };
    return this.withInsightsPreference(base, includeInsights);
  }

  private withCampaignListView(
    stats: FacebookAdCampaignStatsDto,
    options?: { page?: number; pageSize?: number; query?: string },
  ): FacebookAdCampaignStatsDto {
    const pageSize = Math.min(
      MAX_CAMPAIGN_PAGE_SIZE,
      Math.max(1, options?.pageSize ?? DEFAULT_CAMPAIGN_PAGE_SIZE),
    );
    const query = options?.query?.trim() || null;
    const q = query?.toLowerCase() ?? '';

    const filtered = q
      ? stats.campaigns.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q),
        )
      : stats.campaigns;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(
      totalPages,
      Math.max(1, options?.page ?? 1),
    );
    const start = (page - 1) * pageSize;

    const pagination: FacebookAdCampaignPaginationDto = {
      page,
      pageSize,
      total,
      totalPages,
      query,
    };

    return {
      ...stats,
      campaigns: filtered.slice(start, start + pageSize),
      summary: this.buildCampaignStatsSummary(stats.campaigns),
      pagination,
    };
  }

  private buildCampaignStatsSummary(
    campaigns: FacebookAdCampaignDto[],
  ): FacebookAdCampaignStatsSummaryDto {
    const parse = (value: string | null | undefined, allowFloat = false) => {
      if (value == null || value === '') return 0;
      const n = allowFloat ? Number(value) : Number.parseInt(value, 10);
      return Number.isFinite(n) ? n : 0;
    };

    let spend = 0;
    let impressions = 0;
    let reach = 0;
    let clicks = 0;
    let activeCampaigns = 0;
    let ctrWeight = 0;
    let ctrSum = 0;
    let cpcWeight = 0;
    let cpcSum = 0;
    let cpmWeight = 0;
    let cpmSum = 0;
    let freqWeight = 0;
    let freqSum = 0;
    const actionTotals = new Map<string, number>();
    const actionCosts = new Map<string, number>();

    for (const campaign of campaigns) {
      if (campaign.effectiveStatus?.toUpperCase() === 'ACTIVE') {
        activeCampaigns += 1;
      }
      const insights = campaign.insights;
      if (!insights) continue;

      const campSpend = parse(insights.spend, true);
      const campImpr = parse(insights.impressions);
      const campClicks = parse(insights.clicks);
      spend += campSpend;
      impressions += campImpr;
      reach += parse(insights.reach);
      clicks += campClicks;

      const ctr = parse(insights.ctr, true);
      if (campImpr > 0 && ctr > 0) {
        ctrSum += ctr * campImpr;
        ctrWeight += campImpr;
      }
      const cpc = parse(insights.cpc, true);
      if (campClicks > 0 && cpc > 0) {
        cpcSum += cpc * campClicks;
        cpcWeight += campClicks;
      }
      const cpm = parse(insights.cpm, true);
      if (campImpr > 0 && cpm > 0) {
        cpmSum += cpm * campImpr;
        cpmWeight += campImpr;
      }
      const frequency = parse(insights.frequency, true);
      if (campImpr > 0 && frequency > 0) {
        freqSum += frequency * campImpr;
        freqWeight += campImpr;
      }

      for (const action of insights.actions ?? []) {
        const key = action.actionType;
        actionTotals.set(
          key,
          (actionTotals.get(key) ?? 0) + parse(action.value),
        );
      }
      for (const cost of insights.costPerActionType ?? []) {
        const n = parse(cost.value, true);
        if (n > 0) actionCosts.set(cost.actionType, n);
      }
    }

    let primaryActionType: string | null = null;
    let primaryActionValue: string | null = null;
    for (const preferred of PRIMARY_ACTION_PRIORITY) {
      if (actionTotals.has(preferred)) {
        primaryActionType = preferred;
        primaryActionValue = String(actionTotals.get(preferred));
        break;
      }
    }
    if (!primaryActionType && actionTotals.size > 0) {
      const [type, value] = [...actionTotals.entries()][0]!;
      primaryActionType = type;
      primaryActionValue = String(value);
    }

    return {
      spend,
      impressions,
      reach,
      clicks,
      activeCampaigns,
      totalCampaigns: campaigns.length,
      ctr: ctrWeight > 0 ? ctrSum / ctrWeight : null,
      cpc: cpcWeight > 0 ? cpcSum / cpcWeight : null,
      cpm: cpmWeight > 0 ? cpmSum / cpmWeight : null,
      frequency: freqWeight > 0 ? freqSum / freqWeight : null,
      primaryActionType,
      primaryActionValue,
      costPerResult:
        primaryActionType != null
          ? (actionCosts.get(primaryActionType) ?? null)
          : null,
    };
  }

  private withInsightsPreference(
    stats: FacebookAdCampaignStatsDto,
    includeInsights: boolean,
  ): FacebookAdCampaignStatsDto {
    if (includeInsights) return stats;
    return {
      ...stats,
      campaigns: stats.campaigns.map((c) => ({
        ...c,
        insights: null,
        dailyInsights: null,
      })),
      dailyInsights: [],
      breakdowns: null,
    };
  }

  private async fetchAndPersistCampaignStats(
    business: Business,
    adAccountId: string,
    accessToken: string,
    includeInsights: boolean,
  ): Promise<FacebookAdCampaignStatsDto> {
    const accountMeta = await this.fetchAdAccountMeta(adAccountId, accessToken);

    const campaignsResponse =
      await this.graphGetWithToken<FacebookCampaignsResponse>(
        `/${adAccountId}/campaigns`,
        accessToken,
        {
          fields: META_CAMPAIGN_FIELDS,
          limit: '50',
        },
      );

    const rows = (campaignsResponse.data ?? []).filter((row) => {
      if (!row.id?.trim() || !row.name?.trim()) return false;
      const effective = row.effective_status?.toUpperCase() ?? '';
      const status = row.status?.toUpperCase() ?? '';
      if (effective === 'DELETED' || status === 'DELETED') {
        return false;
      }
      return true;
    });

    let campaigns: FacebookAdCampaignStatsDto['campaigns'] = rows.map(
      (row) => ({
        id: row.id!,
        name: row.name!.trim(),
        status: row.status ?? null,
        effectiveStatus: row.effective_status ?? null,
        dailyBudget: row.daily_budget ?? null,
        imageUrl: null,
        insights: null,
        dailyInsights: null,
      }),
    );

    if (campaigns.length > 0) {
      const thumbnailsByCampaignId =
        await this.fetchAccountCampaignThumbnails(adAccountId, accessToken);
      campaigns = campaigns.map((c) => ({
        ...c,
        imageUrl: thumbnailsByCampaignId.get(c.id) ?? null,
      }));

      const missingThumbs = campaigns.filter((c) => !c.imageUrl);
      if (missingThumbs.length > 0) {
        const filled = await this.mapWithConcurrency(
          missingThumbs,
          INSIGHTS_FETCH_CONCURRENCY,
          async (campaign) => {
            const imageUrl = await this.fetchCampaignThumbnail(
              campaign.id,
              accessToken,
            );
            return { id: campaign.id, imageUrl };
          },
        );
        const byId = new Map(filled.map((row) => [row.id, row.imageUrl]));
        campaigns = campaigns.map((c) => ({
          ...c,
          imageUrl: c.imageUrl ?? byId.get(c.id) ?? null,
        }));
      }
    }

    if (includeInsights && campaigns.length > 0) {
      const insightsByCampaignId = await this.fetchAccountCampaignInsights(
        adAccountId,
        accessToken,
      );

      campaigns = campaigns.map((c) => ({
        ...c,
        insights: insightsByCampaignId.get(c.id) ?? null,
      }));

      const stillMissing = campaigns.filter((c) => c.insights == null);
      if (stillMissing.length > 0) {
        const filled = await this.mapWithConcurrency(
          stillMissing,
          INSIGHTS_FETCH_CONCURRENCY,
          async (campaign) => {
            const insights = await this.fetchCampaignInsights(
              campaign.id,
              accessToken,
            );
            return { id: campaign.id, insights };
          },
        );
        const byId = new Map(filled.map((row) => [row.id, row.insights]));
        campaigns = campaigns.map((c) => ({
          ...c,
          insights: c.insights ?? byId.get(c.id) ?? null,
        }));
      }
    }

    let dailyInsights: FacebookAdDailyInsightDto[] = [];
    let breakdowns: FacebookAdInsightBreakdownsDto | null = null;

    if (includeInsights) {
      const [daily, age, device, placement, country, dailyByCampaign] =
        await Promise.all([
          this.fetchAccountDailyInsights(adAccountId, accessToken),
          this.fetchAccountBreakdown(adAccountId, accessToken, 'age'),
          this.fetchAccountBreakdown(
            adAccountId,
            accessToken,
            'impression_device',
          ),
          this.fetchAccountBreakdown(
            adAccountId,
            accessToken,
            'publisher_platform',
          ),
          this.fetchAccountBreakdown(adAccountId, accessToken, 'country'),
          this.fetchAccountCampaignDailyInsights(adAccountId, accessToken),
        ]);
      dailyInsights = daily;
      breakdowns = { age, device, placement, country };
      campaigns = campaigns.map((c) => ({
        ...c,
        dailyInsights: dailyByCampaign.get(c.id) ?? [],
      }));
    }

    const fetchedAt = new Date();
    const result: FacebookAdCampaignStatsDto = {
      adAccountId,
      adAccountName: accountMeta.name,
      currency: accountMeta.currency,
      datePreset: META_AD_STATS_DATE_PRESET,
      campaigns,
      dailyInsights,
      breakdowns,
      fetchedAt: fetchedAt.toISOString(),
      fromCache: false,
      isStale: false,
      summary: null,
      pagination: null,
    };

    await this.upsertCampaignStatsSnapshot(
      business.id,
      adAccountId,
      includeInsights,
      result,
      fetchedAt,
    );

    return result;
  }

  private async upsertCampaignStatsSnapshot(
    businessId: number,
    adAccountId: string,
    includeInsights: boolean,
    result: FacebookAdCampaignStatsDto,
    fetchedAt: Date,
  ): Promise<void> {
    try {
      const existing = await this.findCampaignStatsSnapshot(
        businessId,
        adAccountId,
      );
      const payload = {
        adAccountId: result.adAccountId,
        adAccountName: result.adAccountName,
        currency: result.currency,
        datePreset: result.datePreset,
        campaigns: result.campaigns,
        dailyInsights: result.dailyInsights,
        breakdowns: result.breakdowns,
      } as unknown as Record<string, unknown>;

      if (existing) {
        existing.includeInsights = includeInsights || existing.includeInsights;
        existing.payload = payload;
        existing.fetchedAt = fetchedAt;
        await this.campaignStatsSnapshotRepository.save(existing);
        return;
      }

      await this.campaignStatsSnapshotRepository.save(
        this.campaignStatsSnapshotRepository.create({
          businessId,
          adAccountId,
          datePreset: META_AD_STATS_DATE_PRESET,
          includeInsights,
          payload,
          fetchedAt,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Meta campaign stats snapshot save failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async fetchAccountDailyInsights(
    adAccountId: string,
    accessToken: string,
  ): Promise<FacebookAdDailyInsightDto[]> {
    try {
      const response = await this.graphGetWithToken<{
        data?: Array<{
          date_start?: string;
          spend?: string;
          impressions?: string;
          clicks?: string;
        }>;
      }>(`/${adAccountId}/insights`, accessToken, {
        date_preset: META_AD_STATS_DATE_PRESET,
        time_increment: '1',
        fields: 'spend,impressions,clicks,date_start',
        limit: '50',
      });

      return (response.data ?? [])
        .map((row) => {
          const date = row.date_start?.trim();
          if (!date) return null;
          return {
            date,
            spend: row.spend ?? null,
            impressions: row.impressions ?? null,
            clicks: row.clicks ?? null,
          };
        })
        .filter((row): row is FacebookAdDailyInsightDto => row != null);
    } catch (err) {
      this.logger.warn(
        `Account daily insights skipped for ${adAccountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private async fetchAccountCampaignDailyInsights(
    adAccountId: string,
    accessToken: string,
  ): Promise<Map<string, FacebookAdDailyInsightDto[]>> {
    const out = new Map<string, FacebookAdDailyInsightDto[]>();

    try {
      const response = await this.graphGetWithToken<{
        data?: Array<{
          campaign_id?: string;
          date_start?: string;
          spend?: string;
          impressions?: string;
          clicks?: string;
        }>;
      }>(`/${adAccountId}/insights`, accessToken, {
        level: 'campaign',
        date_preset: META_AD_STATS_DATE_PRESET,
        time_increment: '1',
        fields: 'campaign_id,spend,impressions,clicks,date_start',
        limit: '500',
      });

      for (const row of response.data ?? []) {
        const campaignId = row.campaign_id?.trim();
        const date = row.date_start?.trim();
        if (!campaignId || !date) continue;
        const point: FacebookAdDailyInsightDto = {
          date,
          spend: row.spend ?? null,
          impressions: row.impressions ?? null,
          clicks: row.clicks ?? null,
        };
        const list = out.get(campaignId) ?? [];
        list.push(point);
        out.set(campaignId, list);
      }

      for (const [campaignId, list] of out) {
        list.sort((a, b) => a.date.localeCompare(b.date));
        out.set(campaignId, list);
      }
    } catch (err) {
      this.logger.warn(
        `Campaign daily insights skipped for ${adAccountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return out;
  }

  private async fetchAccountBreakdown(
    adAccountId: string,
    accessToken: string,
    breakdown: 'age' | 'impression_device' | 'publisher_platform' | 'country',
  ): Promise<FacebookAdBreakdownRowDto[]> {
    try {
      const response = await this.graphGetWithToken<{
        data?: Array<
          Record<string, string | undefined> & {
            impressions?: string;
            spend?: string;
          }
        >;
      }>(`/${adAccountId}/insights`, accessToken, {
        date_preset: META_AD_STATS_DATE_PRESET,
        breakdowns: breakdown,
        fields: 'impressions,spend',
        limit: '50',
      });

      return (response.data ?? [])
        .map((row) => {
          const key = row[breakdown]?.trim();
          if (!key) return null;
          return {
            key,
            impressions: row.impressions ?? null,
            spend: row.spend ?? null,
          };
        })
        .filter((row): row is FacebookAdBreakdownRowDto => row != null);
    } catch (err) {
      this.logger.warn(
        `Account ${breakdown} breakdown skipped for ${adAccountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private async fetchAccountCampaignThumbnails(
    adAccountId: string,
    accessToken: string,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();

    try {
      const response = await this.graphGetWithToken<{
        data?: Array<{
          campaign_id?: string;
          creative?: {
            thumbnail_url?: string;
            image_url?: string;
          };
        }>;
      }>(`/${adAccountId}/ads`, accessToken, {
        fields: 'campaign_id,creative{thumbnail_url,image_url}',
        limit: '100',
      });

      for (const row of response.data ?? []) {
        const campaignId = row.campaign_id?.trim();
        if (!campaignId || out.has(campaignId)) continue;
        const url =
          row.creative?.image_url?.trim() ||
          row.creative?.thumbnail_url?.trim() ||
          '';
        if (url) out.set(campaignId, url);
      }
    } catch (err) {
      this.logger.warn(
        `Account campaign thumbnails skipped for ${adAccountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return out;
  }

  private async fetchCampaignThumbnail(
    campaignId: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const response = await this.graphGetWithToken<{
        data?: Array<{
          creative?: {
            thumbnail_url?: string;
            image_url?: string;
          };
        }>;
      }>(`/${campaignId}/ads`, accessToken, {
        fields: 'creative{thumbnail_url,image_url}',
        limit: '1',
      });
      const creative = response.data?.[0]?.creative;
      return (
        creative?.image_url?.trim() ||
        creative?.thumbnail_url?.trim() ||
        null
      );
    } catch (err) {
      this.logger.warn(
        `Thumbnail skipped for campaign ${campaignId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async fetchAccountCampaignInsights(
    adAccountId: string,
    accessToken: string,
  ): Promise<Map<string, FacebookAdCampaignInsightDto>> {
    const out = new Map<string, FacebookAdCampaignInsightDto>();

    try {
      const response = await this.graphGetWithToken<{
        data?: MetaCampaignInsightRow[];
      }>(`/${adAccountId}/insights`, accessToken, {
        level: 'campaign',
        date_preset: META_AD_STATS_DATE_PRESET,
        fields: META_CAMPAIGN_INSIGHT_FIELDS,
        limit: '50',
      });

      for (const row of response.data ?? []) {
        const id = row.campaign_id?.trim();
        if (!id) continue;
        out.set(id, this.normalizeCampaignInsight(row));
      }
    } catch (err) {
      this.logger.warn(
        `Account-level campaign insights skipped for ${adAccountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return out;
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (true) {
          const current = nextIndex;
          nextIndex += 1;
          if (current >= items.length) return;
          results[current] = await mapper(items[current]!);
        }
      },
    );

    await Promise.all(workers);
    return results;
  }

  getConnectionStatus(business: Business): FacebookConnectionStatusDto {
    const grantedScopes = (business.metaOauthScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    const storedRequested = (business.metaRequestedScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    let requestedScopes =
      storedRequested.length > 0
        ? normalizeSelectableMetaScopes(storedRequested)
        : [...grantedScopes];

    if (requestedScopes.length === 0) {
      requestedScopes = [...grantedScopes];
    }

    const requiredScopes = [...requestedScopes];

    const missingRequiredScopes = requiredScopes.filter(
      (scope) => !grantedScopes.includes(scope),
    );

    const connected = Boolean(
      business.metaUserId?.trim() &&
        business.metaAccessToken?.trim() &&
        business.metaConnectionStatus !== FacebookConnectionStatus.FAILED &&
        missingRequiredScopes.length === 0,
    );

    return {
      connected,
      status: business.metaConnectionStatus ?? null,
      metaUserId: business.metaUserId,
      metaConnectedAt: business.metaConnectedAt,
      metaAdAccountId: business.metaAdAccountId,
      metaTokenExpiresAt: business.metaTokenExpiresAt,
      metaOauthScopes: grantedScopes,
      missingRequiredScopes,
      requestedScopes,
      requiredScopes,
    };
  }

  async listAdAccountsForBusiness(
    user: User,
    businessId: number,
  ): Promise<FacebookAdAccountDto[]> {
    const business = await this.requireMetaBusiness(user, businessId);

    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaToken(business);

    const accounts = await this.listAccessibleAdAccounts(accessToken);

    await this.auditService.log(businessId, 'ad_accounts_fetched', {
      status: FacebookConnectionStatus.TOKEN_EXCHANGED,
      metadata: { count: accounts.length },
    });

    return accounts;
  }

  async listPagesForBusiness(
    user: User,
    businessId: number,
  ): Promise<FacebookPageDto[]> {
    const business = await this.requireMetaBusiness(user, businessId);

    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaToken(business);

    const response = await this.graphGetWithToken<{
      data?: Array<{
        id?: string;
        name?: string;
        picture?: { data?: { url?: string } };
      }>;
    }>('/me/accounts', accessToken, {
      fields: 'id,name,picture.type(large)',
      limit: '50',
    });

    return (response.data ?? [])
      .filter((row) => row.id?.trim())
      .map((row) => ({
        id: row.id!.trim(),
        name: row.name?.trim() ?? null,
        pictureUrl: row.picture?.data?.url?.trim() || null,
      }));
  }

  async listAdPixelsForBusiness(
    user: User,
    businessId: number,
  ): Promise<FacebookAdPixelDto[]> {
    const business = await this.requireMetaBusiness(user, businessId);

    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaToken(business);

    const pixels = await this.fetchAdPixelsForBusiness(accessToken, businessId);

    this.logger.log(
      `Meta pixels businessId=${businessId} metaUserId=${business.metaUserId ?? 'unknown'} selectedAdAccountId=${business.metaAdAccountId ?? 'none'} count=${pixels.length}`,
    );

    await this.auditService.log(businessId, 'ad_pixels_fetched', {
      status: FacebookConnectionStatus.AD_ACCOUNT_SELECTED,
      metadata: {
        count: pixels.length,
        metaUserId: business.metaUserId ?? null,
        selectedAdAccountId: business.metaAdAccountId ?? null,
      },
    });

    return pixels;
  }

  private async fetchAdPixelsForBusiness(
    accessToken: string,
    businessId: number,
  ): Promise<FacebookAdPixelDto[]> {
    const adAccounts = await this.listAccessibleAdAccounts(accessToken);

    this.logger.log(
      `Meta pixels fetch start businessId=${businessId} adAccountCount=${adAccounts.length}`,
    );

    if (adAccounts.length === 0) {
      this.logger.warn(
        `Meta pixels no ad accounts businessId=${businessId}. The connected Meta user may have no accessible ad accounts.`,
      );
      return [];
    }

    const byId = new Map<string, FacebookAdPixelDto>();

    for (const account of adAccounts) {
      const adAccountId = account.id.trim();
      if (!adAccountId) continue;

      try {
        const response = await this.graphGetWithToken<{
          data?: Array<{ id?: string | number; name?: string }>;
        }>(`/${adAccountId}/adspixels`, accessToken, {
          fields: 'id,name',
          limit: '100',
        });

        for (const row of response.data ?? []) {
          const id = String(row.id ?? '').trim();
          if (!id || byId.has(id)) continue;
          byId.set(id, {
            id,
            name: row.name?.trim() || null,
          });
        }

        this.logger.log(
          `Meta pixels ad_account.adspixels businessId=${businessId} adAccountId=${adAccountId} accountName=${account.name ?? 'unknown'} returned=${response.data?.length ?? 0}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Meta pixels fetch skipped businessId=${businessId} adAccountId=${adAccountId} message=${message}`,
        );
      }
    }

    const pixels = [...byId.values()].sort((a, b) =>
      (a.name ?? a.id).localeCompare(b.name ?? b.id),
    );

    if (pixels.length === 0) {
      this.logger.warn(
        `Meta pixels returned empty businessId=${businessId} after scanning ${adAccounts.length} ad account(s).`,
      );
    }

    return pixels;
  }

  async setBusinessAdAccount(
    user: User,
    businessId: number,
    adAccountId: string,
  ): Promise<{ metaAdAccountId: string }> {
    const business = await this.requireMetaBusiness(user, businessId);

    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaToken(business);

    const normalizedId = this.normalizeAdAccountId(adAccountId);
    const accounts = await this.listAccessibleAdAccounts(accessToken);
    const match = accounts.find((a) => a.id === normalizedId);

    if (!match) {
      throw new BadRequestException(
        'That ad account is not available for this Facebook connection. Pick one from the list.',
      );
    }

    await this.businessRepository.update(businessId, {
      metaAdAccountId: normalizedId,
      metaConnectionStatus: FacebookConnectionStatus.AD_ACCOUNT_SELECTED,
    });

    await this.auditService.log(businessId, 'meta_connected', {
      status: FacebookConnectionStatus.AD_ACCOUNT_SELECTED,
      metadata: {
        connectedAccount: match.name?.trim() || 'Meta ad account',
      },
    });

    this.logger.log(
      `Business ${businessId} linked to Meta ad account ${normalizedId}`,
    );

    this.triggerBackgroundSync(businessId);

    return { metaAdAccountId: normalizedId };
  }

  async disconnectFacebookForBusiness(
    user: User,
    businessId: number,
  ): Promise<{ disconnected: true }> {
    const business = await this.requireMetaBusiness(user, businessId);

    const hadConnection = Boolean(
      business.metaUserId?.trim() || business.metaAccessToken?.trim(),
    );

    if (!hadConnection) {
      throw new BadRequestException(
        'Facebook is not connected for this business.',
      );
    }

    await this.businessRepository.update(businessId, {
      metaUserId: null,
      metaAccessToken: null,
      metaConnectedAt: null,
      metaAdAccountId: null,
      metaConnectionStatus: null,
      metaTokenExpiresAt: null,
      metaOauthScopes: null,
      metaRequestedScopes: null,
    });

    await this.auditService.log(businessId, 'meta_disconnected', {
      metadata: { connectedAccount: 'Meta Ads was removed' },
    });

    this.logger.log(
      `Facebook disconnected for business ${businessId}`,
    );

    return { disconnected: true };
  }

  verifyWebhook(
    mode: string | undefined,
    verifyToken: string | undefined,
    challenge: string | undefined,
  ): string {
    const expected = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN?.trim();
    if (!expected) {
      throw new InternalServerErrorException(
        'FACEBOOK_WEBHOOK_VERIFY_TOKEN is not configured.',
      );
    }

    if (mode === 'subscribe' && verifyToken === expected && challenge) {
      return challenge;
    }

    throw new BadRequestException('Facebook webhook verification failed.');
  }

  logWebhookPayload(payload: unknown): void {
    this.logger.log(
      `Facebook webhook received: ${JSON.stringify(payload).slice(0, 4000)}`,
    );
  }

  private getStateSecret(): string | undefined {
    return this.getAppSecret();
  }

  private getBusinessAccessToken(business: Business): string | null {
    const stored = business.metaAccessToken?.trim();
    if (!stored) {
      return null;
    }

    try {
      return decryptSecret(stored);
    } catch (err) {
      this.logger.error(
        `Could not decrypt Meta token for business ${business.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private triggerBackgroundSync(businessId: number): void {
    void this.runBackgroundSync(businessId);
  }

  private async runBackgroundSync(businessId: number): Promise<void> {
    await this.businessRepository.update(businessId, {
      metaConnectionStatus: FacebookConnectionStatus.SYNCING,
    });

    await this.auditService.log(businessId, 'sync_started', {
      status: FacebookConnectionStatus.SYNCING,
    });

    try {
      const business = await this.businessRepository.findOne({
        where: { id: businessId },
      });

      if (!business) {
        throw new NotFoundException('Business not found.');
      }

      await this.getAdCampaignStats(business);

      await this.businessRepository.update(businessId, {
        metaConnectionStatus: FacebookConnectionStatus.ACTIVE,
      });

      await this.auditService.log(businessId, 'sync_completed', {
        status: FacebookConnectionStatus.ACTIVE,
        metadata: { adAccountId: business.metaAdAccountId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await this.businessRepository.update(businessId, {
        metaConnectionStatus: FacebookConnectionStatus.FAILED,
      });

      await this.auditService.log(businessId, 'sync_failed', {
        status: FacebookConnectionStatus.FAILED,
        errorMessage: message,
      });
    }
  }

  private getAppId(): string | undefined {
    return (
      process.env.FACEBOOK_APP_ID?.trim() ||
      process.env.META_APP_ID?.trim()
    );
  }

  private getAppSecret(): string | undefined {
    return (
      process.env.FACEBOOK_APP_SECRET?.trim() ||
      process.env.META_APP_SECRET?.trim()
    );
  }

  /** FACEBOOK_REDIRECT_URI is canonical; META_REDIRECT_URI kept for older .env files. */
  private getRedirectUri(): string | undefined {
    return (
      process.env.FACEBOOK_REDIRECT_URI?.trim() ||
      process.env.META_REDIRECT_URI?.trim()
    );
  }

  private async persistExchangedUserToken(
    businessId: number,
    shortLivedAccessToken: string,
    requestedSelectableScopes: string[],
  ): Promise<FacebookOAuthCallbackResultDto> {
    const appId = this.getAppId();
    const appSecret = this.getAppSecret();

    if (!appId || !appSecret) {
      throw new InternalServerErrorException(
        'Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.',
      );
    }

    const longLived = await this.exchangeForLongLivedToken(
      shortLivedAccessToken,
      appId,
      appSecret,
    );
    const accessToken = longLived.accessToken;

    const me = await this.fetchFacebookUser(accessToken);
    if (!me.id?.trim()) {
      throw new BadRequestException(
        'Facebook did not return a user id. Try connecting again.',
      );
    }

    const requestedScopes = normalizeSelectableMetaScopes(
      requestedSelectableScopes,
    );

    const { grantedScopes: rawGranted } =
      await this.metaTokenService.validateAccessTokenForStorage(
        accessToken,
        me.id.trim(),
        requestedScopes,
      );

    const missing = findMissingRequestedScopes(rawGranted, requestedScopes);
    if (missing.length > 0) {
      throw new BadRequestException(
        missing.length === 1
          ? `Meta Ads connection failed because required permission ${missing[0]} was not granted.`
          : `Meta Ads connection failed because required permissions ${missing.join(', ')} were not granted.`,
      );
    }

    const grantedScopes = filterGrantedSelectableScopes(
      rawGranted,
      requestedScopes,
    );

    const tokenExpiresAt =
      longLived.expiresIn != null
        ? new Date(Date.now() + longLived.expiresIn * 1000)
        : null;

    await this.businessRepository.update(businessId, {
      metaUserId: me.id.trim(),
      metaAccessToken: encryptSecret(accessToken),
      metaConnectedAt: new Date(),
      metaAdAccountId: null,
      metaConnectionStatus: FacebookConnectionStatus.TOKEN_EXCHANGED,
      metaTokenExpiresAt: tokenExpiresAt,
      metaOauthScopes: grantedScopes.join(','),
      metaRequestedScopes: requestedScopes.join(','),
    });

    this.logger.log(
      `Facebook connected for business ${businessId} (user ${me.id}) granted=${grantedScopes.join(',')}`,
    );

    const connectedBusiness = await this.businessRepository.findOne({
      where: { id: businessId },
      relations: ['owner'],
    });
    if (connectedBusiness) {
      await this.adminNotificationWriter.notifyIntegrationConnected({
        provider: 'meta',
        businessId,
        businessName: connectedBusiness.name,
        actorUserId: connectedBusiness.owner?.id ?? null,
        idempotencyKey: `meta_connected:${businessId}:${me.id.trim()}`,
        metadata: { metaUserId: me.id, grantedScopes },
      });
    }

    return { connected: true, businessId, grantedScopes };
  }

  private async exchangeCodeForAccessToken(
    code: string,
    appId: string,
    appSecret: string,
    redirectUri: string,
  ): Promise<FacebookTokenResponse> {
    const url = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code', code);

    return this.graphGet<FacebookTokenResponse>(url.toString());
  }

  private async exchangeForLongLivedToken(
    shortLivedToken: string,
    appId: string,
    appSecret: string,
  ): Promise<{ accessToken: string; expiresIn: number | null }> {
    const url = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', shortLivedToken);

    const longJson = await this.graphGet<FacebookTokenResponse>(url.toString());
    return {
      accessToken: longJson.access_token ?? shortLivedToken,
      expiresIn: longJson.expires_in ?? null,
    };
  }

  private async fetchCampaignInsights(
    campaignId: string,
    accessToken: string,
  ): Promise<FacebookAdCampaignInsightDto | null> {
    try {
      const response = await this.graphGetWithToken<{
        data?: MetaCampaignInsightRow[];
      }>(`/${campaignId}/insights`, accessToken, {
        date_preset: META_AD_STATS_DATE_PRESET,
        fields: META_SINGLE_CAMPAIGN_INSIGHT_FIELDS,
      });
      const row = response.data?.[0];
      if (!row) {
        return null;
      }
      return this.normalizeCampaignInsight(row);
    } catch (err) {
      this.logger.warn(
        `Insights skipped for campaign ${campaignId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private normalizeCampaignInsight(
    row: MetaCampaignInsightRow,
  ): FacebookAdCampaignInsightDto {
    return {
      spend: row.spend ?? null,
      impressions: row.impressions ?? null,
      reach: row.reach ?? null,
      clicks: row.clicks ?? null,
      ctr: row.ctr ?? null,
      cpc: row.cpc ?? null,
      cpm: row.cpm ?? null,
      frequency: row.frequency ?? null,
      actions: this.normalizeInsightActions(row.actions),
      costPerActionType: this.normalizeInsightActions(row.cost_per_action_type),
    };
  }

  private normalizeInsightActions(
    rows: MetaInsightActionRow[] | undefined,
  ): FacebookAdCampaignInsightDto['actions'] {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const mapped = rows
      .map((row) => {
        const actionType = row.action_type?.trim();
        const value = row.value?.trim();
        if (!actionType || !value) return null;
        return { actionType, value };
      })
      .filter(
        (row): row is { actionType: string; value: string } => row != null,
      );
    return mapped.length > 0 ? mapped : null;
  }

  private requireBusinessAdAccount(business: Business): {
    id: string;
    name: string | null;
    currency: string | null;
  } {
    const adAccountId = business.metaAdAccountId?.trim();
    if (!adAccountId) {
      throw new BadRequestException(
        'No Facebook ad account has been selected for this business.',
      );
    }

    return {
      id: adAccountId,
      name: null,
      currency: null,
    };
  }

  private normalizeAdAccountId(raw: string): string {
    const trimmed = raw?.trim();
    if (!trimmed) {
      throw new BadRequestException('Ad account id is required.');
    }
    return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
  }

  private async fetchAdAccountMeta(
    adAccountId: string,
    accessToken: string,
  ): Promise<{ name: string | null; currency: string | null; timezoneName: string | null }> {
    try {
      const response = await this.graphGetWithToken<FacebookAdAccountMetaResponse>(
        `/${adAccountId}`,
        accessToken,
        { fields: 'name,currency,timezone_name' },
      );

      return {
        name: response.name ?? null,
        currency: response.currency ?? null,
        timezoneName: response.timezone_name?.trim() || null,
      };
    } catch (err) {
      this.logger.warn(
        `Ad account meta skipped for ${adAccountId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { name: null, currency: null, timezoneName: null };
    }
  }

  private async listAccessibleAdAccounts(
    accessToken: string,
  ): Promise<FacebookAdAccountDto[]> {
    const response = await this.graphGetWithToken<FacebookAdAccountsResponse>(
      '/me/adaccounts',
      accessToken,
      {
        fields: 'id,account_id,name,account_status,currency,timezone_name',
        limit: '50',
      },
    );

    return (response.data ?? [])
      .filter((row) => row.id?.trim())
      .map((row) => ({
        id: row.id!.trim(),
        accountId: row.account_id ?? null,
        name: row.name ?? null,
        accountStatus: row.account_status ?? null,
        currency: row.currency ?? null,
        timezoneName: row.timezone_name?.trim() || null,
      }));
  }

  private async graphGetWithToken<T>(
    path: string,
    accessToken: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${FACEBOOK_GRAPH}${normalized}`);
    url.searchParams.set('access_token', accessToken);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return this.graphGet<T>(url.toString());
  }

  private async fetchFacebookUser(
    accessToken: string,
  ): Promise<{ id: string; name: string | null }> {
    const url = new URL(`${FACEBOOK_GRAPH}/me`);
    url.searchParams.set('fields', 'id,name');
    url.searchParams.set('access_token', accessToken);

    const me = await this.graphGet<FacebookMeResponse>(url.toString());
    if (!me.id) {
      throw new BadRequestException(
        me.error?.message ?? 'Could not read your Facebook profile.',
      );
    }

    return { id: me.id, name: me.name ?? null };
  }

  private async graphGet<T>(url: string): Promise<T> {
    let lastNetworkError: unknown;

    for (let attempt = 0; attempt < GRAPH_FETCH_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(GRAPH_FETCH_TIMEOUT_MS),
        });

        const raw = await res.text();
        let body: T & {
          error?: { message?: string; code?: number; type?: string };
        };

        try {
          body = JSON.parse(raw) as T & {
            error?: { message?: string; code?: number; type?: string };
          };
        } catch {
          this.logger.error(
            `Facebook Graph API non-JSON response (${res.status}): ${raw.slice(0, 200)}`,
          );
          throw new BadRequestException(
            'Facebook returned an unexpected response. Try again in a moment.',
          );
        }

        if (!res.ok) {
          const message =
            body?.error?.message ??
            `Facebook API request failed (${res.status}).`;
          if (body?.error?.code === 190) {
            throw new BadRequestException(
              `${message} Reconnect Facebook in Settings → Integrations.`,
            );
          }
          throw new BadRequestException(message);
        }

        return body;
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw err;
        }
        lastNetworkError = err;
        this.logger.warn(
          `Facebook Graph API attempt ${attempt + 1}/${GRAPH_FETCH_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt < GRAPH_FETCH_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }

    const detail =
      lastNetworkError instanceof Error
        ? lastNetworkError.message
        : String(lastNetworkError);
    this.logger.error(`Facebook Graph API network error: ${detail}`);
    throw new BadRequestException(
      `Could not reach Facebook (${detail}). Ensure the API server has internet access, then reconnect Facebook in Settings if this continues.`,
    );
  }
}
