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
import { User } from '../../db/entities/user.entity';
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';
import { requireAdminRole } from '../../utils/require-admin-role';
import { businessAccessWhere } from '../../utils/business-access';
import { FacebookAdAccountDto } from './dto/facebook-ad-account.dto';
import { FacebookAdCampaignStatsDto } from './dto/facebook-ad-campaign-stats.dto';
import { FacebookConnectionStatusDto } from './dto/facebook-connection-status.dto';
import { FacebookPageDto } from './dto/facebook-page.dto';
import { FacebookOAuthCallbackResultDto } from './dto/facebook-oauth-callback-result.dto';
import { FacebookConnectionStatus } from './facebook-connection-status';
import { FacebookIntegrationAuditService } from './facebook-integration-audit.service';
import { FacebookMetaTokenService, META_REQUIRED_SCOPES } from './facebook-meta-token.service';
import {
  createFacebookOAuthState,
  parseFacebookOAuthState,
} from './facebook-oauth-state';
import {
  destinationUrlMatchesCampaignLanding,
  extractCreativeDestinationUrl,
  resolveExpectedCampaignLandingUrl,
  type MetaCreativeLinkPayload,
} from './meta-campaign-destination-filter';

const FACEBOOK_GRAPH = 'https://graph.facebook.com/v23.0';
const FACEBOOK_OAUTH_DIALOG = 'https://www.facebook.com/v23.0/dialog/oauth';
const FACEBOOK_OAUTH_SCOPES =
  'ads_management,ads_read,business_management,pages_show_list,pages_read_engagement';

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
  error?: { message?: string };
};

type FacebookAdAccountsResponse = {
  data?: Array<{
    id?: string;
    account_id?: string;
    name?: string;
    account_status?: number;
    currency?: string;
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
const GRAPH_FETCH_TIMEOUT_MS = 25_000;
const GRAPH_FETCH_RETRIES = 2;

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly auditService: FacebookIntegrationAuditService,
    private readonly metaTokenService: FacebookMetaTokenService,
  ) {}

  async connect(user: User, businessId: number): Promise<{ url: string }> {
    requireAdminRole(
      user,
      'You do not have permission to connect Facebook for this account.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
      relations: ['owner'],
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    await this.businessRepository.update(businessId, {
      metaConnectionStatus: FacebookConnectionStatus.INITIATED,
    });

    await this.auditService.log(businessId, 'oauth_started', {
      status: FacebookConnectionStatus.INITIATED,
    });

    return this.createOAuthConnectUrl(businessId);
  }

  async createOAuthConnectUrl(
    businessId: number,
  ): Promise<{ url: string }> {
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

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state: createFacebookOAuthState(businessId, stateSecret),
      scope: FACEBOOK_OAUTH_SCOPES,
      response_type: 'code',
      auth_type: 'rerequest',
    });

    return {
      url: `${FACEBOOK_OAUTH_DIALOG}?${params.toString()}`,
    };
  }

  async handleOAuthCallback(
    code: string | undefined,
    state: string | undefined,
    oauthError: string | undefined,
    oauthErrorDescription: string | undefined,
  ): Promise<FacebookOAuthCallbackResultDto> {
    let businessId: number | null = null;

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

      await this.auditService.log(businessId, 'oauth_callback_received', {
        status: FacebookConnectionStatus.AUTHENTICATED,
      });

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

      let accessToken = tokenJson.access_token;
      if (!accessToken) {
        throw new BadRequestException(
          tokenJson.error?.message ??
            'Facebook did not return an access token. Try connecting again.',
        );
      }

      const longLived = await this.exchangeForLongLivedToken(
        accessToken,
        appId,
        appSecret,
      );
      accessToken = longLived.accessToken;

      const me = await this.fetchFacebookUser(accessToken);
      if (!me.id?.trim()) {
        throw new BadRequestException(
          'Facebook did not return a user id. Try connecting again.',
        );
      }

      const { grantedScopes } =
        await this.metaTokenService.validateAccessTokenForStorage(
          accessToken,
          me.id.trim(),
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
      });

      await this.auditService.log(businessId, 'token_exchanged', {
        status: FacebookConnectionStatus.TOKEN_EXCHANGED,
        metadata: { metaUserId: me.id, grantedScopes },
      });

      this.logger.log(
        `Facebook connected for business ${businessId} (user ${me.id})`,
      );

      return { connected: true, businessId };
    } catch (err) {
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
      }
      throw err;
    }
  }

  async getAdCampaignStats(
    business: Business,
    filterWebsiteUrl?: string | null,
  ): Promise<FacebookAdCampaignStatsDto> {
    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaCredentials(business);

    const adAccount = this.requireBusinessAdAccount(business);
    const accountMeta = await this.fetchAdAccountMeta(adAccount.id, accessToken);
    const expectedLanding = resolveExpectedCampaignLandingUrl(filterWebsiteUrl);

    const campaignsResponse =
      await this.graphGetWithToken<FacebookCampaignsResponse>(
        `/${adAccount.id}/campaigns`,
        accessToken,
        {
          fields: META_CAMPAIGN_FIELDS,
          limit: '50',
        },
      );

    const campaignDestinationLinks = expectedLanding
      ? await this.fetchCampaignDestinationLinks(adAccount.id, accessToken)
      : new Map<string, string>();

    const rows = (campaignsResponse.data ?? []).filter((row) => {
      if (!row.id?.trim() || !row.name?.trim()) return false;
      const effective = row.effective_status?.toUpperCase() ?? '';
      const status = row.status?.toUpperCase() ?? '';
      if (effective === 'DELETED' || status === 'DELETED') {
        return false;
      }

      if (!expectedLanding) {
        return true;
      }

      const destination = campaignDestinationLinks.get(row.id!.trim());
      if (!destination) {
        return false;
      }

      return destinationUrlMatchesCampaignLanding(destination, expectedLanding);
    });

    const campaigns = await Promise.all(
      rows.map(async (row) => {
        const insights = await this.fetchCampaignInsights(
          row.id!,
          accessToken,
        );
        return {
          id: row.id!,
          name: row.name!.trim(),
          status: row.status ?? null,
          effectiveStatus: row.effective_status ?? null,
          dailyBudget: row.daily_budget ?? null,
          insights,
        };
      }),
    );

    return {
      adAccountId: adAccount.id,
      adAccountName: accountMeta.name,
      currency: accountMeta.currency,
      datePreset: META_AD_STATS_DATE_PRESET,
      campaigns,
    };
  }

  getConnectionStatus(business: Business): FacebookConnectionStatusDto {
    const grantedScopes = (business.metaOauthScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    const missingRequiredScopes = META_REQUIRED_SCOPES.filter(
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
      missingRequiredScopes: [...missingRequiredScopes],
    };
  }

  async listAdAccountsForBusiness(
    user: User,
    businessId: number,
  ): Promise<FacebookAdAccountDto[]> {
    requireAdminRole(
      user,
      'You do not have permission to list Facebook ad accounts.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

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
    requireAdminRole(
      user,
      'You do not have permission to list Facebook pages.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    const { accessToken } =
      await this.metaTokenService.assertBusinessMetaToken(business);

    const response = await this.graphGetWithToken<{
      data?: Array<{ id?: string; name?: string }>;
    }>('/me/accounts', accessToken, { fields: 'id,name', limit: '50' });

    return (response.data ?? [])
      .filter((row) => row.id?.trim())
      .map((row) => ({
        id: row.id!.trim(),
        name: row.name?.trim() ?? null,
      }));
  }

  async setBusinessAdAccount(
    user: User,
    businessId: number,
    adAccountId: string,
  ): Promise<{ metaAdAccountId: string }> {
    requireAdminRole(
      user,
      'You do not have permission to set the Facebook ad account.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

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

    await this.auditService.log(businessId, 'ad_account_selected', {
      status: FacebookConnectionStatus.AD_ACCOUNT_SELECTED,
      metadata: { adAccountId: normalizedId },
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
    requireAdminRole(
      user,
      'You do not have permission to disconnect Facebook.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    const hadConnection = Boolean(
      business.metaUserId?.trim() || business.metaAccessToken?.trim(),
    );

    if (!hadConnection) {
      throw new BadRequestException(
        'Facebook is not connected for this business.',
      );
    }

    const previousAdAccountId = business.metaAdAccountId?.trim() ?? null;
    const previousMetaUserId = business.metaUserId?.trim() ?? null;

    await this.businessRepository.update(businessId, {
      metaUserId: null,
      metaAccessToken: null,
      metaConnectedAt: null,
      metaAdAccountId: null,
      metaConnectionStatus: null,
      metaTokenExpiresAt: null,
      metaOauthScopes: null,
    });

    await this.auditService.log(businessId, 'meta_disconnected', {
      metadata: { previousAdAccountId, previousMetaUserId },
    });

    this.logger.log(
      `Facebook disconnected for business ${businessId} (removed ad account ${previousAdAccountId ?? 'none'})`,
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

  private async fetchCampaignDestinationLinks(
    adAccountId: string,
    accessToken: string,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    try {
      const response = await this.graphGetWithToken<{
        data?: Array<{
          campaign_id?: string;
          creative?: MetaCreativeLinkPayload;
        }>;
      }>(`/${adAccountId}/ads`, accessToken, {
        fields:
          'campaign_id,creative{link_url,object_story_spec,asset_feed_spec}',
        limit: '500',
      });

      for (const row of response.data ?? []) {
        const campaignId = row.campaign_id?.trim();
        if (!campaignId || map.has(campaignId)) {
          continue;
        }

        const link = extractCreativeDestinationUrl(row.creative);
        if (link) {
          map.set(campaignId, link);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not load ad destination links for ${adAccountId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return map;
  }

  private async fetchCampaignInsights(
    campaignId: string,
    accessToken: string,
  ): Promise<{
    spend: string | null;
    impressions: string | null;
    reach: string | null;
    clicks: string | null;
  } | null> {
    try {
      const response = await this.graphGetWithToken<{
        data?: Array<{
          spend?: string;
          impressions?: string;
          reach?: string;
          clicks?: string;
        }>;
      }>(`/${campaignId}/insights`, accessToken, {
        date_preset: META_AD_STATS_DATE_PRESET,
        fields: 'spend,impressions,reach,clicks',
      });
      const row = response.data?.[0];
      if (!row) {
        return null;
      }
      return {
        spend: row.spend ?? null,
        impressions: row.impressions ?? null,
        reach: row.reach ?? null,
        clicks: row.clicks ?? null,
      };
    } catch (err) {
      this.logger.warn(
        `Insights skipped for campaign ${campaignId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
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
  ): Promise<{ name: string | null; currency: string | null }> {
    try {
      const response = await this.graphGetWithToken<FacebookAdAccountMetaResponse>(
        `/${adAccountId}`,
        accessToken,
        { fields: 'name,currency' },
      );

      return {
        name: response.name ?? null,
        currency: response.currency ?? null,
      };
    } catch (err) {
      this.logger.warn(
        `Ad account meta skipped for ${adAccountId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { name: null, currency: null };
    }
  }

  private async listAccessibleAdAccounts(
    accessToken: string,
  ): Promise<FacebookAdAccountDto[]> {
    const response = await this.graphGetWithToken<FacebookAdAccountsResponse>(
      '/me/adaccounts',
      accessToken,
      {
        fields: 'id,account_id,name,account_status,currency',
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
