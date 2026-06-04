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
import { requireAdminRole } from '../../utils/require-admin-role';
import { FacebookAdAccountDto } from './dto/facebook-ad-account.dto';
import { FacebookAdCampaignStatsDto } from './dto/facebook-ad-campaign-stats.dto';
import { FacebookConnectionStatusDto } from './dto/facebook-connection-status.dto';
import { FacebookOAuthCallbackResultDto } from './dto/facebook-oauth-callback-result.dto';

const FACEBOOK_GRAPH = 'https://graph.facebook.com/v23.0';
const FACEBOOK_OAUTH_DIALOG = 'https://www.facebook.com/v23.0/dialog/oauth';
const FACEBOOK_OAUTH_SCOPES =
  'pages_show_list,pages_read_engagement,ads_read';

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
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
  ) {}

  async connect(user: User, restaurantId: number): Promise<{ url: string }> {
    requireAdminRole(
      user,
      'You do not have permission to connect Facebook for this account.',
    );

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: user.id } },
      relations: ['owner'],
    });

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    return this.createOAuthConnectUrl(restaurantId);
  }

  async createOAuthConnectUrl(
    restaurantId: number,
  ): Promise<{ url: string }> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
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

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state: String(restaurantId),
      scope: FACEBOOK_OAUTH_SCOPES,
      response_type: 'code',
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

    const restaurantId = Number.parseInt(state, 10);

    if (!Number.isFinite(restaurantId) || restaurantId < 1) {
      throw new BadRequestException('Invalid Facebook OAuth state.');
    }

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
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

    accessToken = await this.exchangeForLongLivedToken(
      accessToken,
      appId,
      appSecret,
    );

    const me = await this.fetchFacebookUser(accessToken);

    await this.restaurantRepository.update(restaurantId, {
      metaUserId: me.id,
      metaAccessToken: accessToken,
      metaConnectedAt: new Date(),
      metaAdAccountId: null,
    });

    this.logger.log(
      `Facebook connected for restaurant ${restaurantId} (user ${me.id})`,
    );

    return { connected: true, restaurantId };
  }

  async getAdCampaignStats(
    restaurant: Restaurant,
  ): Promise<FacebookAdCampaignStatsDto> {
    const accessToken = restaurant.metaAccessToken?.trim();
    if (!accessToken || !restaurant.metaUserId?.trim()) {
      throw new BadRequestException(
        'Facebook is not connected for this restaurant. Connect Facebook in settings first.',
      );
    }

    const adAccount = this.requireRestaurantAdAccount(restaurant);
    const accounts = await this.listAccessibleAdAccounts(accessToken);
    const accountMeta = accounts.find((a) => a.id === adAccount.id);

    const campaignsResponse =
      await this.graphGetWithToken<FacebookCampaignsResponse>(
        `/${adAccount.id}/campaigns`,
        accessToken,
        {
          fields: META_CAMPAIGN_FIELDS,
          limit: '50',
        },
      );

    const rows = (campaignsResponse.data ?? []).filter(
      (row) => row.id && row.name,
    );

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
      adAccountName: accountMeta?.name ?? null,
      currency: accountMeta?.currency ?? null,
      datePreset: META_AD_STATS_DATE_PRESET,
      campaigns,
    };
  }

  getConnectionStatus(restaurant: Restaurant): FacebookConnectionStatusDto {
    const connected = Boolean(
      restaurant.metaUserId?.trim() && restaurant.metaAccessToken?.trim(),
    );

    return {
      connected,
      metaUserId: restaurant.metaUserId,
      metaConnectedAt: restaurant.metaConnectedAt,
      metaAdAccountId: restaurant.metaAdAccountId,
    };
  }

  async listAdAccountsForRestaurant(
    user: User,
    restaurantId: number,
  ): Promise<FacebookAdAccountDto[]> {
    requireAdminRole(
      user,
      'You do not have permission to list Facebook ad accounts.',
    );

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: user.id } },
    });

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    const accessToken = restaurant.metaAccessToken?.trim();
    if (!accessToken) {
      throw new BadRequestException(
        'Facebook is not connected for this restaurant. Connect Facebook first.',
      );
    }

    return this.listAccessibleAdAccounts(accessToken);
  }

  async setRestaurantAdAccount(
    user: User,
    restaurantId: number,
    adAccountId: string,
  ): Promise<{ metaAdAccountId: string }> {
    requireAdminRole(
      user,
      'You do not have permission to set the Facebook ad account.',
    );

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: user.id } },
    });

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    const accessToken = restaurant.metaAccessToken?.trim();
    if (!accessToken) {
      throw new BadRequestException(
        'Facebook is not connected for this restaurant. Connect Facebook first.',
      );
    }

    const normalizedId = this.normalizeAdAccountId(adAccountId);
    const accounts = await this.listAccessibleAdAccounts(accessToken);
    const match = accounts.find((a) => a.id === normalizedId);

    if (!match) {
      throw new BadRequestException(
        'That ad account is not available for this Facebook connection. Pick one from the list.',
      );
    }

    await this.restaurantRepository.update(restaurantId, {
      metaAdAccountId: normalizedId,
    });

    this.logger.log(
      `Restaurant ${restaurantId} linked to Meta ad account ${normalizedId}`,
    );

    return { metaAdAccountId: normalizedId };
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
  ): Promise<string> {
    const url = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', shortLivedToken);

    const longJson = await this.graphGet<FacebookTokenResponse>(url.toString());
    return longJson.access_token ?? shortLivedToken;
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

  private requireRestaurantAdAccount(restaurant: Restaurant): {
    id: string;
    name: string | null;
    currency: string | null;
  } {
    const adAccountId = restaurant.metaAdAccountId?.trim();
    if (!adAccountId) {
      throw new BadRequestException(
        'No Facebook ad account has been selected for this restaurant.',
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
