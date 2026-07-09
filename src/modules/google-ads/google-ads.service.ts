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
import { encryptSecret } from '../../utils/token-encryption.util';
import { requireAdminRole } from '../../utils/require-admin-role';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { GoogleAdsCampaignStatsDto } from './dto/google-ads-campaign-stats.dto';
import { GoogleAdsConnectionStatusDto } from './dto/google-ads-connection-status.dto';
import { GoogleAdsCustomerDto } from './dto/google-ads-customer.dto';
import { GoogleOAuthCallbackResultDto } from './dto/google-oauth-callback-result.dto';
import { GoogleAdsConnectionStatus } from './google-ads-connection-status';
import type { GoogleAdsConnectionStatusValue } from './google-ads-connection-status';
import { GoogleAdsIntegrationAuditService } from './google-ads-integration-audit.service';
import {
  createGoogleOAuthState,
  parseGoogleOAuthState,
} from './google-oauth-state';
import {
  GOOGLE_ADS_REQUIRED_SCOPE,
  GoogleAdsTokenService,
} from './google-ads-token.service';

const GOOGLE_OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DEFAULT_GOOGLE_ADS_API_VERSION = 'v22';

function googleAdsApiBaseUrl(): string {
  const version =
    process.env.GOOGLE_ADS_API_VERSION?.trim() || DEFAULT_GOOGLE_ADS_API_VERSION;
  return `https://googleads.googleapis.com/${version}`;
}

type GoogleAdsApiErrorBody = {
  error?: {
    message?: string;
    status?: string;
    code?: number;
    details?: GoogleAdsFailureDetail[];
  };
  details?: GoogleAdsFailureDetail[];
};

type GoogleAdsFailureDetail = {
  '@type'?: string;
  errors?: Array<{
    errorCode?: Record<string, string>;
    message?: string;
  }>;
};
const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_ADS_REQUIRED_SCOPE,
  'openid',
  'email',
  'profile',
].join(' ');
const GOOGLE_AD_STATS_DATE_PRESET = 'LAST_30_DAYS';
const API_TIMEOUT_MS = 25_000;

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  id?: string;
  email?: string;
  error?: { message?: string };
};

type GoogleAdsSearchRow = {
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
  };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: string;
  };
  customer?: {
    descriptiveName?: string;
    descriptive_name?: string;
    currencyCode?: string;
    currency_code?: string;
    manager?: boolean;
  };
};

type GoogleAdsCustomerClientRow = {
  customerClient?: {
    id?: string;
    descriptiveName?: string;
    descriptive_name?: string;
    currencyCode?: string;
    currency_code?: string;
    manager?: boolean;
    level?: string | number;
    status?: string;
  };
};

@Injectable()
export class GoogleAdsService {
  private readonly logger = new Logger(GoogleAdsService.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly auditService: GoogleAdsIntegrationAuditService,
    private readonly tokenService: GoogleAdsTokenService,
  ) {}

  async connect(user: User, businessId: number): Promise<{ url: string }> {
    requireAdminRole(
      user,
      'You do not have permission to connect Google Ads for this account.',
    );

    const business = await this.businessRepository.findOne({
      where: { id: businessId, owner: { id: user.id } },
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    if (!business.googleRefreshToken?.trim()) {
      await this.businessRepository.update(businessId, {
        googleConnectionStatus: GoogleAdsConnectionStatus.INITIATED,
      });
    }

    await this.auditService.log(businessId, 'oauth_started', {
      status: GoogleAdsConnectionStatus.INITIATED,
    });

    return this.createOAuthConnectUrl(businessId);
  }

  async abortOAuthConnect(
    user: User,
    businessId: number,
  ): Promise<{ restored: true }> {
    requireAdminRole(
      user,
      'You do not have permission to update Google Ads for this account.',
    );

    const business = await this.loadOwnedBusiness(user, businessId);

    if (business.googleConnectionStatus !== GoogleAdsConnectionStatus.INITIATED) {
      return { restored: true };
    }

    const hasGoogleLogin = Boolean(
      business.googleUserId?.trim() && business.googleRefreshToken?.trim(),
    );

    let restoredStatus: GoogleAdsConnectionStatusValue | null = null;

    if (hasGoogleLogin && business.googleCustomerId?.trim()) {
      restoredStatus = GoogleAdsConnectionStatus.CUSTOMER_SELECTED;
    } else if (hasGoogleLogin) {
      restoredStatus = GoogleAdsConnectionStatus.TOKEN_EXCHANGED;
    }

    await this.businessRepository.update(businessId, {
      googleConnectionStatus: restoredStatus,
    });

    await this.auditService.log(businessId, 'oauth_aborted', {
      status: restoredStatus,
    });

    return { restored: true };
  }

  createOAuthConnectUrl(businessId: number): { url: string } {
    const clientId = this.tokenService.getClientId();
    const clientSecret = this.tokenService.getClientSecret();
    const redirectUri = this.getRedirectUri();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH_SCOPES,
      state: createGoogleOAuthState(businessId, clientSecret),
      access_type: 'offline',
      prompt: 'consent select_account',
    });

    return { url: `${GOOGLE_OAUTH_AUTH}?${params.toString()}` };
  }

  parseBusinessIdFromOAuthState(state: string | undefined): number | null {
    if (!state?.trim()) {
      return null;
    }
    try {
      return parseGoogleOAuthState(state, this.tokenService.getClientSecret());
    } catch {
      return null;
    }
  }

  async handleOAuthCallback(
    code: string | undefined,
    state: string | undefined,
    oauthError: string | undefined,
    oauthErrorDescription: string | undefined,
    grantedScope: string | undefined,
  ): Promise<GoogleOAuthCallbackResultDto> {
    let businessId: number | null = null;

    try {
      if (oauthError) {
        throw new BadRequestException(
          oauthErrorDescription?.trim() ||
            oauthError ||
            'Google connection was cancelled.',
        );
      }

      if (!code?.trim()) {
        throw new BadRequestException('Missing Google OAuth code.');
      }

      if (!state?.trim()) {
        throw new BadRequestException('Missing Google OAuth state.');
      }

      const clientSecret = this.tokenService.getClientSecret();
      businessId = parseGoogleOAuthState(state, clientSecret);

      const callbackScopes = this.parseScopeList(grantedScope);
      if (callbackScopes.length > 0) {
        this.tokenService.assertGoogleScopes(callbackScopes);
      }

      await this.auditService.log(businessId, 'oauth_callback_received', {
        status: GoogleAdsConnectionStatus.AUTHENTICATED,
      });

      const business = await this.businessRepository.findOne({
        where: { id: businessId },
      });

      if (!business) {
        throw new NotFoundException('Business not found.');
      }

      const tokenJson = await this.exchangeCodeForTokens(
        code.trim(),
        this.getRedirectUri(),
      );

      if (!tokenJson.access_token) {
        throw new BadRequestException(
          tokenJson.error_description ??
            tokenJson.error ??
            'Google did not return an access token. Try connecting again.',
        );
      }

      if (!tokenJson.refresh_token?.trim()) {
        throw new BadRequestException(
          'Google did not return a refresh token. Disconnect the app in your Google Account permissions, then connect again.',
        );
      }

      const me = await this.fetchGoogleUser(tokenJson.access_token);
      const googleUserId = me.email?.trim() || me.id?.trim();
      if (!googleUserId) {
        throw new BadRequestException(
          'Google did not return a user profile. Try connecting again.',
        );
      }

      const grantedScopes = this.mergeScopeLists(
        callbackScopes,
        this.parseScopeList(tokenJson.scope),
      );
      this.tokenService.assertGoogleScopes(grantedScopes);

      const tokenExpiresAt =
        tokenJson.expires_in != null
          ? new Date(Date.now() + tokenJson.expires_in * 1000)
          : null;

      await this.businessRepository.update(businessId, {
        googleUserId,
        googleRefreshToken: encryptSecret(tokenJson.refresh_token.trim()),
        googleAccessToken: encryptSecret(tokenJson.access_token),
        googleConnectedAt: new Date(),
        googleCustomerId: null,
        googleLoginCustomerId: null,
        googleConnectionStatus: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
        googleTokenExpiresAt: tokenExpiresAt,
        googleOauthScopes: grantedScopes.join(','),
      });

      await this.auditService.log(businessId, 'token_exchanged', {
        status: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
        metadata: { googleUserId, grantedScopes },
      });

      this.logger.log(
        `Google Ads connected for business ${businessId} (user ${googleUserId})`,
      );

      return { connected: true, businessId };
    } catch (err) {
      if (businessId != null) {
        await this.businessRepository.update(businessId, {
          googleUserId: null,
          googleRefreshToken: null,
          googleAccessToken: null,
          googleConnectedAt: null,
          googleCustomerId: null,
          googleLoginCustomerId: null,
          googleConnectionStatus: GoogleAdsConnectionStatus.FAILED,
          googleTokenExpiresAt: null,
          googleOauthScopes: null,
        });
        await this.auditService.log(businessId, 'oauth_failed', {
          status: GoogleAdsConnectionStatus.FAILED,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }

  getConnectionStatus(business: Business): GoogleAdsConnectionStatusDto {
    const normalized = this.normalizeConnectionStatus(business);

    const grantedScopes = (normalized.googleOauthScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    const missingRequiredScopes = grantedScopes.some(
      (scope) =>
        scope === GOOGLE_ADS_REQUIRED_SCOPE || scope.includes('auth/adwords'),
    )
      ? []
      : [GOOGLE_ADS_REQUIRED_SCOPE];

    const hasGoogleLogin = Boolean(
      normalized.googleUserId?.trim() &&
        normalized.googleRefreshToken?.trim(),
    );

    const status = normalized.googleConnectionStatus ?? null;

    const connected = Boolean(
      hasGoogleLogin &&
        missingRequiredScopes.length === 0 &&
        status !== GoogleAdsConnectionStatus.INITIATED,
    );

    return {
      connected,
      status,
      googleUserId: normalized.googleUserId,
      googleConnectedAt: normalized.googleConnectedAt,
      googleCustomerId: normalized.googleCustomerId,
      googleTokenExpiresAt: normalized.googleTokenExpiresAt,
      googleOauthScopes: grantedScopes,
      missingRequiredScopes,
    };
  }

  private normalizeConnectionStatus(business: Business): Business {
    const hasGoogleLogin = Boolean(
      business.googleUserId?.trim() && business.googleRefreshToken?.trim(),
    );

    if (
      hasGoogleLogin &&
      business.googleConnectionStatus === GoogleAdsConnectionStatus.FAILED
    ) {
      const repairedStatus = business.googleCustomerId?.trim()
        ? GoogleAdsConnectionStatus.CUSTOMER_SELECTED
        : GoogleAdsConnectionStatus.TOKEN_EXCHANGED;

      void this.businessRepository.update(business.id, {
        googleConnectionStatus: repairedStatus,
      });

      return {
        ...business,
        googleConnectionStatus: repairedStatus,
      };
    }

    return business;
  }

  async listCustomersForBusiness(
    user: User,
    businessId: number,
  ): Promise<GoogleAdsCustomerDto[]> {
    requireAdminRole(
      user,
      'You do not have permission to list Google Ads accounts.',
    );

    const business = await this.loadOwnedBusiness(user, businessId);
    const { accessToken } =
      await this.tokenService.assertBusinessGoogleToken(business);

    const scopes = (business.googleOauthScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    this.tokenService.assertGoogleScopes(scopes);

    const customers = await this.listAccessibleCustomers(accessToken);

    await this.auditService.log(businessId, 'customers_fetched', {
      status: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
      metadata: { count: customers.length },
    });

    return customers;
  }

  async setBusinessCustomer(
    user: User,
    businessId: number,
    customerId: string,
    managerCustomerId?: string,
  ): Promise<{ googleCustomerId: string }> {
    requireAdminRole(
      user,
      'You do not have permission to set the Google Ads account.',
    );

    const business = await this.loadOwnedBusiness(user, businessId);
    const { accessToken } =
      await this.tokenService.assertBusinessGoogleToken(business);

    const normalizedId = this.normalizeCustomerId(customerId);
    const customers = await this.listAccessibleCustomers(accessToken);
    const match = customers.find((c) => c.id === normalizedId);

    if (!match) {
      throw new BadRequestException(
        'That Google Ads account is not available for this Google login. Pick one from the list.',
      );
    }

    const loginCustomerId = match.managerCustomerId?.trim()
      ? this.normalizeCustomerId(match.managerCustomerId)
      : normalizedId;

    await this.businessRepository.update(businessId, {
      googleCustomerId: normalizedId,
      googleLoginCustomerId: loginCustomerId,
      googleConnectionStatus: GoogleAdsConnectionStatus.CUSTOMER_SELECTED,
    });

    await this.auditService.log(businessId, 'customer_selected', {
      status: GoogleAdsConnectionStatus.CUSTOMER_SELECTED,
      metadata: {
        customerId: normalizedId,
        loginCustomerId,
        isManager: match.isManager,
      },
    });

    this.logger.log(
      `Business ${businessId} linked to Google Ads customer ${normalizedId}`,
    );

    this.triggerBackgroundSync(businessId);

    return { googleCustomerId: normalizedId };
  }

  async disconnectGoogleAdsForBusiness(
    user: User,
    businessId: number,
  ): Promise<{ disconnected: true }> {
    requireAdminRole(
      user,
      'You do not have permission to disconnect Google Ads.',
    );

    const business = await this.loadOwnedBusiness(user, businessId);

    const hadConnection = Boolean(
      business.googleUserId?.trim() || business.googleRefreshToken?.trim(),
    );

    if (!hadConnection) {
      throw new BadRequestException(
        'Google Ads is not connected for this business.',
      );
    }

    const previousCustomerId = business.googleCustomerId?.trim() ?? null;
    const previousGoogleUserId = business.googleUserId?.trim() ?? null;

    await this.businessRepository.update(businessId, {
      googleUserId: null,
      googleRefreshToken: null,
      googleAccessToken: null,
      googleConnectedAt: null,
      googleCustomerId: null,
      googleLoginCustomerId: null,
      googleConnectionStatus: null,
      googleTokenExpiresAt: null,
      googleOauthScopes: null,
    });

    await this.auditService.log(businessId, 'google_ads_disconnected', {
      metadata: { previousCustomerId, previousGoogleUserId },
    });

    this.logger.log(
      `Google Ads disconnected for business ${businessId} (removed customer ${previousCustomerId ?? 'none'})`,
    );

    return { disconnected: true };
  }

  async getAdCampaignStats(
    business: Business,
  ): Promise<GoogleAdsCampaignStatsDto> {
    const { accessToken, customerId, loginCustomerId } =
      await this.tokenService.assertBusinessGoogleCredentials(business);

    const customerMeta = await this.fetchCustomerMeta(
      accessToken,
      customerId!,
      loginCustomerId,
    );
    const campaigns = await this.fetchCampaignStats(
      accessToken,
      customerId!,
      loginCustomerId,
    );

    return {
      customerId,
      customerName: customerMeta.name,
      currency: customerMeta.currency,
      datePreset: GOOGLE_AD_STATS_DATE_PRESET,
      campaigns,
    };
  }

  private async fetchCampaignStats(
    accessToken: string,
    customerId: string,
    loginCustomerId: string = customerId,
  ): Promise<GoogleAdsCampaignStatsDto['campaigns']> {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
    `.trim();

    const rows = await this.googleAdsSearch<GoogleAdsSearchRow>(
      accessToken,
      customerId,
      query,
      loginCustomerId,
    );

    const aggregated = new Map<
      string,
      {
        id: string;
        name: string;
        status: string | null;
        costMicros: number;
        impressions: number;
        clicks: number;
        conversions: number;
      }
    >();

    for (const row of rows) {
      const id = row.campaign?.id?.trim();
      if (!id) continue;

      const existing = aggregated.get(id) ?? {
        id,
        name: row.campaign?.name?.trim() || 'Unnamed campaign',
        status: row.campaign?.status ?? null,
        costMicros: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };

      existing.costMicros += Number.parseInt(row.metrics?.costMicros ?? '0', 10) || 0;
      existing.impressions +=
        Number.parseInt(row.metrics?.impressions ?? '0', 10) || 0;
      existing.clicks += Number.parseInt(row.metrics?.clicks ?? '0', 10) || 0;
      existing.conversions +=
        Number.parseFloat(row.metrics?.conversions ?? '0') || 0;

      aggregated.set(id, existing);
    }

    return [...aggregated.values()].map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      effectiveStatus: row.status,
      dailyBudget: null,
      insights: {
        spend: String(row.costMicros / 1_000_000),
        impressions: String(row.impressions),
        clicks: String(row.clicks),
        conversions: String(row.conversions),
      },
    }));
  }

  private async fetchCustomerMeta(
    accessToken: string,
    customerId: string,
    loginCustomerId: string = customerId,
  ): Promise<{
    name: string | null;
    currency: string | null;
    isManager: boolean;
  }> {
    const query =
      'SELECT customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1';

    const rows = await this.googleAdsSearch<GoogleAdsSearchRow>(
      accessToken,
      customerId,
      query,
      loginCustomerId,
    );

    return this.parseCustomerResource(rows[0]?.customer);
  }

  private parseCustomerResource(
    customer?: GoogleAdsSearchRow['customer'],
  ): { name: string | null; currency: string | null; isManager: boolean } {
    if (!customer) {
      return { name: null, currency: null, isManager: false };
    }

    const name =
      customer.descriptiveName?.trim() ||
      customer.descriptive_name?.trim() ||
      null;
    const currency =
      customer.currencyCode?.trim() ||
      customer.currency_code?.trim() ||
      null;

    return {
      name,
      currency,
      isManager: customer.manager === true,
    };
  }

  private async tryFetchCustomerMeta(
    accessToken: string,
    customerId: string,
    loginCustomerId: string,
  ): Promise<{
    name: string | null;
    currency: string | null;
    isManager: boolean;
  } | null> {
    try {
      return await this.fetchCustomerMeta(
        accessToken,
        customerId,
        loginCustomerId,
      );
    } catch (err) {
      this.logger.debug(
        `Google Ads customer meta lookup failed (customer=${customerId}, login=${loginCustomerId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async enrichAccessibleCustomers(
    accessToken: string,
    ids: string[],
  ): Promise<GoogleAdsCustomerDto[]> {
    if (ids.length === 0) {
      return [];
    }

    const metaById = new Map<
      string,
      { name: string | null; currency: string | null; isManager: boolean }
    >();

    for (const id of ids) {
      const meta = await this.tryFetchCustomerMeta(accessToken, id, id);
      if (meta) {
        metaById.set(id, meta);
      }
    }

    const managerIds = ids.filter((id) => metaById.get(id)?.isManager);

    for (const id of ids) {
      const existing = metaById.get(id);
      if (existing?.name) {
        continue;
      }

      const loginCandidates = [
        ...managerIds.filter((managerId) => managerId !== id),
        ...ids.filter((otherId) => otherId !== id),
      ];

      for (const loginId of loginCandidates) {
        const meta = await this.tryFetchCustomerMeta(accessToken, id, loginId);
        if (!meta?.name) {
          continue;
        }

        metaById.set(id, {
          name: meta.name,
          currency: meta.currency ?? existing?.currency ?? null,
          isManager: meta.isManager || existing?.isManager || false,
        });
        break;
      }
    }

    return ids.map((id) => {
      const meta = metaById.get(id);
      return {
        id,
        name: meta?.name ?? null,
        currency: meta?.currency ?? null,
        isManager: meta?.isManager ?? false,
        managerCustomerId: null,
        status: null,
      };
    });
  }

  private async fetchDirectClientAccounts(
    accessToken: string,
    managerCustomerId: string,
  ): Promise<GoogleAdsCustomerDto[]> {
    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.manager,
        customer_client.status
      FROM customer_client
      WHERE customer_client.level = 1
    `.trim();

    try {
      const rows = await this.googleAdsSearch<GoogleAdsCustomerClientRow>(
        accessToken,
        managerCustomerId,
        query,
        managerCustomerId,
      );

      const clients: GoogleAdsCustomerDto[] = [];

      for (const row of rows) {
        const client = row.customerClient;
        const id = String(client?.id ?? '').replace(/\D/g, '');
        if (!id || id === managerCustomerId.replace(/\D/g, '')) {
          continue;
        }

        clients.push({
          id,
          name:
            client?.descriptiveName?.trim() ||
            client?.descriptive_name?.trim() ||
            null,
          currency:
            client?.currencyCode?.trim() ||
            client?.currency_code?.trim() ||
            null,
          isManager: client?.manager === true,
          managerCustomerId,
          status: client?.status?.trim() ?? null,
        });
      }

      return clients;
    } catch (err) {
      this.logger.debug(
        `Google Ads client account lookup failed (manager=${managerCustomerId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async buildFullCustomerList(
    accessToken: string,
    rootIds: string[],
  ): Promise<GoogleAdsCustomerDto[]> {
    const enriched = await this.enrichAccessibleCustomers(accessToken, rootIds);
    const byId = new Map(enriched.map((customer) => [customer.id, customer]));

    for (const id of rootIds) {
      const children = await this.fetchDirectClientAccounts(accessToken, id);
      for (const child of children) {
        if (!byId.has(child.id)) {
          byId.set(child.id, child);
        }
      }
    }

    return [...byId.values()].sort((a, b) => {
      if (a.isManager !== b.isManager) {
        return a.isManager ? -1 : 1;
      }
      return (a.name ?? a.id).localeCompare(b.name ?? b.id);
    });
  }

  private async listAccessibleCustomers(
    accessToken: string,
  ): Promise<GoogleAdsCustomerDto[]> {
    const developerToken = this.tokenService.getDeveloperToken();
    const url = `${googleAdsApiBaseUrl()}/customers:listAccessibleCustomers`;

    const res = await fetch(url, {
      method: 'GET',
      headers: this.googleAdsReadHeaders(accessToken, developerToken),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const body = await this.readGoogleAdsJson<{
      resourceNames?: string[];
    }>(res, 'listAccessibleCustomers');

    if (!res.ok) {
      throw new BadRequestException(
        this.googleAdsErrorMessage(
          body,
          'Could not list Google Ads accounts. Check your developer token, enable Google Ads API in Google Cloud Console, and reconnect.',
        ),
      );
    }

    const ids = (body.resourceNames ?? [])
      .map((name) => name.replace(/^customers\//, '').trim())
      .filter(Boolean);

    return this.buildFullCustomerList(accessToken, ids);
  }

  private async googleAdsSearch<T>(
    accessToken: string,
    customerId: string,
    query: string,
    loginCustomerId?: string,
  ): Promise<T[]> {
    const developerToken = this.tokenService.getDeveloperToken();
    const normalizedCustomerId = this.normalizeCustomerId(customerId);
    const normalizedLoginCustomerId = loginCustomerId
      ? this.normalizeCustomerId(loginCustomerId)
      : normalizedCustomerId;
    const url = `${googleAdsApiBaseUrl()}/customers/${normalizedCustomerId}/googleAds:search`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.googleAdsWriteHeaders(
        accessToken,
        developerToken,
        normalizedLoginCustomerId,
      ),
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const body = await this.readGoogleAdsJson<{ results?: T[] }>(
      res,
      'googleAds:search',
    );

    if (!res.ok) {
      throw new BadRequestException(
        this.googleAdsErrorMessage(
          body,
          'Google Ads API request failed. Reconnect Google Ads in Settings → Integrations.',
        ),
      );
    }

    return body.results ?? [];
  }

  private googleAdsReadHeaders(
    accessToken: string,
    developerToken: string,
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
    };
  }

  private googleAdsWriteHeaders(
    accessToken: string,
    developerToken: string,
    loginCustomerId: string,
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'login-customer-id': loginCustomerId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async readGoogleAdsJson<T>(
    res: Response,
    context: string,
  ): Promise<T & GoogleAdsApiErrorBody> {
    const raw = await res.text();
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith('<')) {
      this.logger.error(
        `Google Ads API non-JSON response (${context}) status=${res.status} url=${res.url} body=${trimmed.slice(0, 400)}`,
      );
      throw new BadRequestException(
        res.status === 404
          ? 'Google Ads API endpoint was not found. Enable Google Ads API in Google Cloud Console (Dealioo project) and verify GOOGLE_ADS_DEVELOPER_TOKEN.'
          : `Google Ads API returned an unexpected HTML response (HTTP ${res.status}). Enable Google Ads API in Google Cloud Console and verify your developer token.`,
      );
    }

    try {
      return JSON.parse(trimmed) as T & GoogleAdsApiErrorBody;
    } catch {
      this.logger.error(
        `Google Ads API invalid JSON (${context}) status=${res.status} body=${trimmed.slice(0, 400)}`,
      );
      throw new BadRequestException(
        `Google Ads API returned invalid data (HTTP ${res.status}). Check developer token and Google Ads API setup.`,
      );
    }
  }

  private googleAdsErrorMessage(
    body: GoogleAdsApiErrorBody,
    fallback: string,
  ): string {
    const failureMessage = this.extractGoogleAdsFailureMessage(body);
    const message = failureMessage ?? body.error?.message?.trim();
    if (!message) {
      return fallback;
    }

    if (
      message.includes('DEVELOPER_TOKEN_PROHIBITED') ||
      message.includes('not allowed with project')
    ) {
      return `${message} Your developer token is tied to a different Google Cloud project. Use matching OAuth credentials or request a new developer token for this project.`;
    }

    if (body.error?.status === 'PERMISSION_DENIED') {
      return `${message} Ensure Google Ads API is enabled and your developer token is approved.`;
    }

    if (body.error?.status === 'INVALID_ARGUMENT' && message === 'Request contains an invalid argument.') {
      const specific = this.extractGoogleAdsFailureMessage(body, true);
      if (specific && specific !== message) {
        return specific;
      }
    }

    return message;
  }

  private extractGoogleAdsFailureMessage(
    body: GoogleAdsApiErrorBody,
    preferSpecific = false,
  ): string | null {
    const details = body.error?.details ?? body.details ?? [];
    const messages: string[] = [];

    for (const detail of details) {
      for (const err of detail.errors ?? []) {
        const codeKey = err.errorCode ? Object.keys(err.errorCode)[0] : null;
        const codeValue = codeKey ? err.errorCode?.[codeKey] : null;
        const text = err.message?.trim();
        if (codeValue === 'DEVELOPER_TOKEN_PROHIBITED') {
          return `Developer token is not allowed with this Google Cloud project (${codeValue}).`;
        }
        if (text) {
          messages.push(preferSpecific && codeValue ? `${text} (${codeValue})` : text);
        }
      }
    }

    return messages.length > 0 ? messages.join(' ') : null;
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
  ): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.tokenService.getClientId(),
      client_secret: this.tokenService.getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetch(GOOGLE_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    return (await res.json()) as GoogleTokenResponse;
  }

  private async fetchGoogleUser(
    accessToken: string,
  ): Promise<{ id: string | null; email: string | null }> {
    const url = new URL(GOOGLE_USERINFO);
    url.searchParams.set('access_token', accessToken);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const me = (await res.json()) as GoogleUserInfo;
    if (!res.ok) {
      throw new BadRequestException(
        me.error?.message ?? 'Could not read your Google profile.',
      );
    }

    return { id: me.id ?? null, email: me.email ?? null };
  }

  private normalizeCustomerId(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      throw new BadRequestException('Google Ads customer id is required.');
    }
    return digits;
  }

  private parseScopeList(raw: string | undefined): string[] {
    return (raw ?? '')
      .split(/[\s+]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  private mergeScopeLists(...groups: string[][]): string[] {
    return [...new Set(groups.flat())];
  }

  private getRedirectUri(): string {
    const uri = process.env.GOOGLE_REDIRECT_URI?.trim();
    if (!uri) {
      throw new InternalServerErrorException(
        'Set GOOGLE_REDIRECT_URI to your OAuth callback URL (e.g. frontend /auth/google/callback).',
      );
    }
    return uri;
  }

  private triggerBackgroundSync(businessId: number): void {
    void this.runBackgroundSync(businessId);
  }

  private async runBackgroundSync(businessId: number): Promise<void> {
    await this.businessRepository.update(businessId, {
      googleConnectionStatus: GoogleAdsConnectionStatus.SYNCING,
    });

    await this.auditService.log(businessId, 'sync_started', {
      status: GoogleAdsConnectionStatus.SYNCING,
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
        googleConnectionStatus: GoogleAdsConnectionStatus.ACTIVE,
      });

      await this.auditService.log(businessId, 'sync_completed', {
        status: GoogleAdsConnectionStatus.ACTIVE,
        metadata: { customerId: business.googleCustomerId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      const business = await this.businessRepository.findOne({
        where: { id: businessId },
      });

      const fallbackStatus = business?.googleCustomerId?.trim()
        ? GoogleAdsConnectionStatus.CUSTOMER_SELECTED
        : GoogleAdsConnectionStatus.TOKEN_EXCHANGED;

      await this.businessRepository.update(businessId, {
        googleConnectionStatus: fallbackStatus,
      });

      await this.auditService.log(businessId, 'sync_failed', {
        status: fallbackStatus,
        errorMessage: message,
      });

      this.logger.warn(
        `Google Ads sync failed for business ${businessId}: ${message}`,
      );
    }
  }

  private async loadOwnedBusiness(
    user: User,
    businessId: number,
  ): Promise<Business> {
    const business = await this.businessRepository.findOne({
      where: { id: businessId, owner: { id: user.id } },
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return business;
  }
}
