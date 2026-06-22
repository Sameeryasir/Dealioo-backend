import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { encryptSecret } from '../../utils/token-encryption.util';
import { requireAdminRole } from '../../utils/require-admin-role';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { GoogleAdsCampaignStatsDto } from './dto/google-ads-campaign-stats.dto';
import { GoogleAdsConnectionStatusDto } from './dto/google-ads-connection-status.dto';
import { GoogleAdsCustomerDto } from './dto/google-ads-customer.dto';
import { GoogleOAuthCallbackResultDto } from './dto/google-oauth-callback-result.dto';
import { GoogleAdsConnectionStatus } from './google-ads-connection-status';
import { GoogleAdsIntegrationAuditService } from './google-ads-integration-audit.service';
import {
  GOOGLE_ADS_REQUIRED_SCOPE,
  GoogleAdsTokenService,
} from './google-ads-token.service';
import {
  createGoogleOAuthState,
  parseGoogleOAuthState,
} from './google-oauth-state';

const GOOGLE_OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v18';
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
    currencyCode?: string;
  };
};

@Injectable()
export class GoogleAdsService {
  private readonly logger = new Logger(GoogleAdsService.name);

  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    private readonly auditService: GoogleAdsIntegrationAuditService,
    private readonly tokenService: GoogleAdsTokenService,
  ) {}

  async connect(user: User, restaurantId: number): Promise<{ url: string }> {
    requireAdminRole(
      user,
      'You do not have permission to connect Google Ads for this account.',
    );

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: user.id } },
    });

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    await this.restaurantRepository.update(restaurantId, {
      googleConnectionStatus: GoogleAdsConnectionStatus.INITIATED,
    });

    await this.auditService.log(restaurantId, 'oauth_started', {
      status: GoogleAdsConnectionStatus.INITIATED,
    });

    return this.createOAuthConnectUrl(restaurantId);
  }

  createOAuthConnectUrl(restaurantId: number): { url: string } {
    const clientId = this.tokenService.getClientId();
    const clientSecret = this.tokenService.getClientSecret();
    const redirectUri = this.getRedirectUri();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH_SCOPES,
      state: createGoogleOAuthState(restaurantId, clientSecret),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });

    return { url: `${GOOGLE_OAUTH_AUTH}?${params.toString()}` };
  }

  async handleOAuthCallback(
    code: string | undefined,
    state: string | undefined,
    oauthError: string | undefined,
    oauthErrorDescription: string | undefined,
  ): Promise<GoogleOAuthCallbackResultDto> {
    let restaurantId: number | null = null;

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
      restaurantId = parseGoogleOAuthState(state, clientSecret);

      await this.auditService.log(restaurantId, 'oauth_callback_received', {
        status: GoogleAdsConnectionStatus.AUTHENTICATED,
      });

      const restaurant = await this.restaurantRepository.findOne({
        where: { id: restaurantId },
      });

      if (!restaurant) {
        throw new NotFoundException('Restaurant not found.');
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

      const grantedScopes = (tokenJson.scope ?? GOOGLE_OAUTH_SCOPES)
        .split(' ')
        .filter(Boolean);
      this.tokenService.assertGoogleScopes(grantedScopes);

      const tokenExpiresAt =
        tokenJson.expires_in != null
          ? new Date(Date.now() + tokenJson.expires_in * 1000)
          : null;

      await this.restaurantRepository.update(restaurantId, {
        googleUserId,
        googleRefreshToken: encryptSecret(tokenJson.refresh_token.trim()),
        googleAccessToken: encryptSecret(tokenJson.access_token),
        googleConnectedAt: new Date(),
        googleCustomerId: null,
        googleConnectionStatus: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
        googleTokenExpiresAt: tokenExpiresAt,
        googleOauthScopes: grantedScopes.join(','),
      });

      await this.auditService.log(restaurantId, 'token_exchanged', {
        status: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
        metadata: { googleUserId, grantedScopes },
      });

      this.logger.log(
        `Google Ads connected for restaurant ${restaurantId} (user ${googleUserId})`,
      );

      return { connected: true, restaurantId };
    } catch (err) {
      if (restaurantId != null) {
        await this.restaurantRepository.update(restaurantId, {
          googleUserId: null,
          googleRefreshToken: null,
          googleAccessToken: null,
          googleConnectedAt: null,
          googleCustomerId: null,
          googleConnectionStatus: GoogleAdsConnectionStatus.FAILED,
          googleTokenExpiresAt: null,
          googleOauthScopes: null,
        });
        await this.auditService.log(restaurantId, 'oauth_failed', {
          status: GoogleAdsConnectionStatus.FAILED,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }

  getConnectionStatus(restaurant: Restaurant): GoogleAdsConnectionStatusDto {
    const grantedScopes = (restaurant.googleOauthScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    const missingRequiredScopes = grantedScopes.some(
      (scope) =>
        scope === GOOGLE_ADS_REQUIRED_SCOPE || scope.includes('auth/adwords'),
    )
      ? []
      : [GOOGLE_ADS_REQUIRED_SCOPE];

    const connected = Boolean(
      restaurant.googleUserId?.trim() &&
        restaurant.googleRefreshToken?.trim() &&
        restaurant.googleConnectionStatus !== GoogleAdsConnectionStatus.FAILED &&
        missingRequiredScopes.length === 0,
    );

    return {
      connected,
      status: restaurant.googleConnectionStatus ?? null,
      googleUserId: restaurant.googleUserId,
      googleConnectedAt: restaurant.googleConnectedAt,
      googleCustomerId: restaurant.googleCustomerId,
      googleTokenExpiresAt: restaurant.googleTokenExpiresAt,
      googleOauthScopes: grantedScopes,
      missingRequiredScopes,
    };
  }

  async listCustomersForRestaurant(
    user: User,
    restaurantId: number,
  ): Promise<GoogleAdsCustomerDto[]> {
    requireAdminRole(
      user,
      'You do not have permission to list Google Ads accounts.',
    );

    const restaurant = await this.loadOwnedRestaurant(user, restaurantId);
    const { accessToken } =
      await this.tokenService.assertRestaurantGoogleToken(restaurant);

    const customers = await this.listAccessibleCustomers(accessToken);

    await this.auditService.log(restaurantId, 'customers_fetched', {
      status: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
      metadata: { count: customers.length },
    });

    return customers;
  }

  async setRestaurantCustomer(
    user: User,
    restaurantId: number,
    customerId: string,
  ): Promise<{ googleCustomerId: string }> {
    requireAdminRole(
      user,
      'You do not have permission to set the Google Ads account.',
    );

    const restaurant = await this.loadOwnedRestaurant(user, restaurantId);
    const { accessToken } =
      await this.tokenService.assertRestaurantGoogleToken(restaurant);

    const normalizedId = this.normalizeCustomerId(customerId);
    const customers = await this.listAccessibleCustomers(accessToken);
    const match = customers.find((c) => c.id === normalizedId);

    if (!match) {
      throw new BadRequestException(
        'That Google Ads account is not available for this Google login. Pick one from the list.',
      );
    }

    await this.restaurantRepository.update(restaurantId, {
      googleCustomerId: normalizedId,
      googleConnectionStatus: GoogleAdsConnectionStatus.CUSTOMER_SELECTED,
    });

    await this.auditService.log(restaurantId, 'customer_selected', {
      status: GoogleAdsConnectionStatus.CUSTOMER_SELECTED,
      metadata: { customerId: normalizedId },
    });

    this.logger.log(
      `Restaurant ${restaurantId} linked to Google Ads customer ${normalizedId}`,
    );

    this.triggerBackgroundSync(restaurantId);

    return { googleCustomerId: normalizedId };
  }

  async disconnectGoogleAdsForRestaurant(
    user: User,
    restaurantId: number,
  ): Promise<{ disconnected: true }> {
    requireAdminRole(
      user,
      'You do not have permission to disconnect Google Ads.',
    );

    const restaurant = await this.loadOwnedRestaurant(user, restaurantId);

    const hadConnection = Boolean(
      restaurant.googleUserId?.trim() || restaurant.googleRefreshToken?.trim(),
    );

    if (!hadConnection) {
      throw new BadRequestException(
        'Google Ads is not connected for this restaurant.',
      );
    }

    const previousCustomerId = restaurant.googleCustomerId?.trim() ?? null;
    const previousGoogleUserId = restaurant.googleUserId?.trim() ?? null;

    await this.restaurantRepository.update(restaurantId, {
      googleUserId: null,
      googleRefreshToken: null,
      googleAccessToken: null,
      googleConnectedAt: null,
      googleCustomerId: null,
      googleConnectionStatus: null,
      googleTokenExpiresAt: null,
      googleOauthScopes: null,
    });

    await this.auditService.log(restaurantId, 'google_ads_disconnected', {
      metadata: { previousCustomerId, previousGoogleUserId },
    });

    this.logger.log(
      `Google Ads disconnected for restaurant ${restaurantId} (removed customer ${previousCustomerId ?? 'none'})`,
    );

    return { disconnected: true };
  }

  async getAdCampaignStats(
    restaurant: Restaurant,
  ): Promise<GoogleAdsCampaignStatsDto> {
    const { accessToken, customerId } =
      await this.tokenService.assertRestaurantGoogleCredentials(restaurant);

    const customerMeta = await this.fetchCustomerMeta(accessToken, customerId!);
    const campaigns = await this.fetchCampaignStats(accessToken, customerId!);

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
  ): Promise<{ name: string | null; currency: string | null }> {
    const query =
      'SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1';

    const rows = await this.googleAdsSearch<GoogleAdsSearchRow>(
      accessToken,
      customerId,
      query,
    );

    const customer = rows[0]?.customer;
    return {
      name: customer?.descriptiveName?.trim() ?? null,
      currency: customer?.currencyCode?.trim() ?? null,
    };
  }

  private async listAccessibleCustomers(
    accessToken: string,
  ): Promise<GoogleAdsCustomerDto[]> {
    const developerToken = this.tokenService.getDeveloperToken();
    const url = `${GOOGLE_ADS_API}/customers:listAccessibleCustomers`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const body = (await res.json()) as {
      resourceNames?: string[];
      error?: { message?: string; status?: string };
    };

    if (!res.ok) {
      throw new BadRequestException(
        body.error?.message ??
          'Could not list Google Ads accounts. Check your developer token and reconnect.',
      );
    }

    const ids = (body.resourceNames ?? [])
      .map((name) => name.replace(/^customers\//, '').trim())
      .filter(Boolean);

    const customers: GoogleAdsCustomerDto[] = [];

    for (const id of ids) {
      try {
        const meta = await this.fetchCustomerMeta(accessToken, id);
        customers.push({
          id,
          name: meta.name,
          currency: meta.currency,
          isManager: false,
        });
      } catch {
        customers.push({
          id,
          name: null,
          currency: null,
          isManager: false,
        });
      }
    }

    return customers;
  }

  private async googleAdsSearch<T>(
    accessToken: string,
    customerId: string,
    query: string,
  ): Promise<T[]> {
    const developerToken = this.tokenService.getDeveloperToken();
    const url = `${GOOGLE_ADS_API}/customers/${customerId}/googleAds:search`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const body = (await res.json()) as {
      results?: T[];
      error?: { message?: string; status?: string };
    };

    if (!res.ok) {
      throw new BadRequestException(
        body.error?.message ??
          'Google Ads API request failed. Reconnect Google Ads in Settings → Integrations.',
      );
    }

    return body.results ?? [];
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

  private getRedirectUri(): string {
    const uri = process.env.GOOGLE_REDIRECT_URI?.trim();
    if (!uri) {
      throw new InternalServerErrorException(
        'Set GOOGLE_REDIRECT_URI to your OAuth callback URL (e.g. frontend /auth/google/callback).',
      );
    }
    return uri;
  }

  private triggerBackgroundSync(restaurantId: number): void {
    void this.runBackgroundSync(restaurantId);
  }

  private async runBackgroundSync(restaurantId: number): Promise<void> {
    await this.restaurantRepository.update(restaurantId, {
      googleConnectionStatus: GoogleAdsConnectionStatus.SYNCING,
    });

    await this.auditService.log(restaurantId, 'sync_started', {
      status: GoogleAdsConnectionStatus.SYNCING,
    });

    try {
      const restaurant = await this.restaurantRepository.findOne({
        where: { id: restaurantId },
      });

      if (!restaurant) {
        throw new NotFoundException('Restaurant not found.');
      }

      await this.getAdCampaignStats(restaurant);

      await this.restaurantRepository.update(restaurantId, {
        googleConnectionStatus: GoogleAdsConnectionStatus.ACTIVE,
      });

      await this.auditService.log(restaurantId, 'sync_completed', {
        status: GoogleAdsConnectionStatus.ACTIVE,
        metadata: { customerId: restaurant.googleCustomerId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await this.restaurantRepository.update(restaurantId, {
        googleConnectionStatus: GoogleAdsConnectionStatus.FAILED,
      });

      await this.auditService.log(restaurantId, 'sync_failed', {
        status: GoogleAdsConnectionStatus.FAILED,
        errorMessage: message,
      });
    }
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
}
