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
    });

    this.logger.log(
      `Facebook connected for restaurant ${restaurantId} (user ${me.id})`,
    );

    return { connected: true, restaurantId };
  }

  getConnectionStatus(restaurant: Restaurant): FacebookConnectionStatusDto {
    const connected = Boolean(
      restaurant.metaUserId?.trim() && restaurant.metaAccessToken?.trim(),
    );

    return {
      connected,
      metaUserId: restaurant.metaUserId,
      metaConnectedAt: restaurant.metaConnectedAt,
    };
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
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      this.logger.error(
        `Facebook Graph API network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        'Could not reach Facebook. Check your connection and try again.',
      );
    }

    const body = (await res.json()) as T & {
      error?: { message?: string };
    };

    if (!res.ok) {
      throw new BadRequestException(
        body?.error?.message ??
          `Facebook API request failed (${res.status}).`,
      );
    }

    return body;
  }
}
