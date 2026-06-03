import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { FacebookConnection } from '../../../db/entities/facebook-connection.entity';
import { FacebookPage } from '../../../db/entities/facebook-page.entity';
import { User } from '../../../db/entities/user.entity';
import { FacebookConnectResponseDto } from './dto/facebook-connect-response.dto';
import { FacebookPageDto } from './dto/facebook-page.dto';
import { JwtAccessPayload } from '../jwt/jwt-access-payload.interface';

const FACEBOOK_GRAPH = 'https://graph.facebook.com/v23.0';
const FACEBOOK_OAUTH_DIALOG = 'https://www.facebook.com/v23.0/dialog/oauth';
const FACEBOOK_OAUTH_SCOPES =
  'pages_show_list,pages_read_engagement,ads_read';

type FacebookTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
};

type FacebookMeResponse = {
  id?: string;
  name?: string;
  error?: { message?: string };
};

type FacebookAccountsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    access_token?: string;
  }>;
  error?: { message?: string };
};

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(
    @InjectRepository(FacebookConnection)
    private readonly connectionRepository: Repository<FacebookConnection>,
    @InjectRepository(FacebookPage)
    private readonly pageRepository: Repository<FacebookPage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async resolveUserIdFromAccessToken(accessToken: string): Promise<number> {
    const token = accessToken?.trim();
    if (!token) {
      throw new UnauthorizedException(
        'Missing access token. Sign in again before connecting Facebook.',
      );
    }

    const secret = process.env.JWT_SECRET?.trim();
    if (!secret) {
      throw new InternalServerErrorException('JWT_SECRET is not configured.');
    }

    try {
      const payload = jwt.verify(token, secret) as unknown as JwtAccessPayload;
      const userId = Number(payload.sub);
      if (!Number.isFinite(userId) || userId < 1) {
        throw new UnauthorizedException('Invalid session token.');
      }

      const user = await this.userRepository.findOne({
        where: { id: userId, isActive: true },
      });
      if (!user) {
        throw new UnauthorizedException('User not found or inactive.');
      }

      return userId;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired session token.');
    }
  }

  buildOAuthLoginUrl(userId: number): string {
    const appId = process.env.FACEBOOK_APP_ID?.trim();
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI?.trim();

    if (!appId) {
      throw new InternalServerErrorException(
        'Set FACEBOOK_APP_ID in environment variables.',
      );
    }
    if (!redirectUri) {
      throw new InternalServerErrorException(
        'Set FACEBOOK_REDIRECT_URI in environment variables.',
      );
    }

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: FACEBOOK_OAUTH_SCOPES,
      response_type: 'code',
      state: String(userId),
    });

    return `${FACEBOOK_OAUTH_DIALOG}?${params.toString()}`;
  }

  async handleOAuthCallback(
    code: string | undefined,
    state: string | undefined,
    oauthError: string | undefined,
    oauthErrorDescription: string | undefined,
  ): Promise<FacebookConnectResponseDto> {
    if (oauthError) {
      const message =
        oauthErrorDescription?.trim() ||
        oauthError ||
        'Facebook connection was cancelled.';
      throw new BadRequestException(message);
    }

    if (!code?.trim()) {
      throw new BadRequestException('Missing Facebook authorization code.');
    }

    const userId = Number.parseInt(state ?? '', 10);
    if (!Number.isFinite(userId) || userId < 1) {
      throw new BadRequestException('Invalid Facebook OAuth state.');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });
    if (!user) {
      throw new BadRequestException('User not found for this Facebook connection.');
    }

    const tokenData = await this.exchangeCodeForAccessToken(code.trim());
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new BadRequestException(
        tokenData.error?.message ??
          'Facebook did not return a valid access token.',
      );
    }

    const expiry = this.expiryFromExpiresIn(tokenData.expires_in);
    const me = await this.fetchFacebookUser(accessToken);
    const pages = await this.fetchFacebookPages(accessToken);

    await this.saveConnection(userId, {
      accessToken,
      facebookUserId: me.id,
      facebookUserName: me.name,
      expiry,
      pages,
    });

    return {
      success: true,
      connected: true,
      facebook_user_id: me.id,
      facebook_user_name: me.name,
      pages: pages.map((p) => ({
        page_id: p.pageId,
        page_name: p.pageName,
        page_access_token: p.pageAccessToken,
      })),
    };
  }

  async getConnectionStatus(userId: number): Promise<FacebookConnectResponseDto> {
    const connection = await this.connectionRepository.findOne({
      where: { userId },
      relations: ['pages'],
    });

    if (!connection) {
      return {
        success: true,
        connected: false,
        facebook_user_id: null,
        facebook_user_name: null,
        pages: [],
      };
    }

    if (connection.expiry && connection.expiry.getTime() < Date.now()) {
      return {
        success: true,
        connected: false,
        facebook_user_id: connection.facebookUserId,
        facebook_user_name: connection.facebookUserName,
        pages: [],
      };
    }

    const pages: FacebookPageDto[] = (connection.pages ?? []).map((p) => ({
      page_id: p.pageId,
      page_name: p.pageName,
      page_access_token: p.pageAccessToken,
    }));

    return {
      success: true,
      connected: true,
      facebook_user_id: connection.facebookUserId,
      facebook_user_name: connection.facebookUserName,
      pages,
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

    throw new BadRequestException('Webhook verification failed.');
  }

  logWebhookPayload(payload: unknown): void {
    this.logger.log(
      `Facebook webhook received: ${JSON.stringify(payload).slice(0, 4000)}`,
    );
  }

  private async exchangeCodeForAccessToken(
    code: string,
  ): Promise<FacebookTokenResponse> {
    const appId = process.env.FACEBOOK_APP_ID?.trim();
    const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI?.trim();

    if (!appId || !appSecret || !redirectUri) {
      throw new InternalServerErrorException(
        'Set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_REDIRECT_URI.',
      );
    }

    const url = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code', code);

    return this.graphGet<FacebookTokenResponse>(url.toString());
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
        me.error?.message ?? 'Could not read Facebook user profile.',
      );
    }

    return { id: me.id, name: me.name ?? null };
  }

  private async fetchFacebookPages(
    accessToken: string,
  ): Promise<
    Array<{ pageId: string; pageName: string; pageAccessToken: string }>
  > {
    const url = new URL(`${FACEBOOK_GRAPH}/me/accounts`);
    url.searchParams.set('access_token', accessToken);

    const accounts = await this.graphGet<FacebookAccountsResponse>(url.toString());
    if (accounts.error) {
      throw new BadRequestException(
        accounts.error.message ?? 'Could not load Facebook pages.',
      );
    }

    return (accounts.data ?? [])
      .filter((p) => p.id && p.name && p.access_token)
      .map((p) => ({
        pageId: p.id!,
        pageName: p.name!,
        pageAccessToken: p.access_token!,
      }));
  }

  private async saveConnection(
    userId: number,
    data: {
      accessToken: string;
      facebookUserId: string;
      facebookUserName: string | null;
      expiry: Date | null;
      pages: Array<{
        pageId: string;
        pageName: string;
        pageAccessToken: string;
      }>;
    },
  ): Promise<void> {
    const now = new Date();
    let connection = await this.connectionRepository.findOne({
      where: { userId },
    });

    if (connection) {
      connection.facebookAccessToken = data.accessToken;
      connection.facebookUserId = data.facebookUserId;
      connection.facebookUserName = data.facebookUserName;
      connection.expiry = data.expiry;
      connection.connectedAt = now;
      await this.connectionRepository.save(connection);
    } else {
      connection = this.connectionRepository.create({
        userId,
        facebookAccessToken: data.accessToken,
        facebookUserId: data.facebookUserId,
        facebookUserName: data.facebookUserName,
        expiry: data.expiry,
        connectedAt: now,
      });
      connection = await this.connectionRepository.save(connection);
    }

    await this.pageRepository.delete({ userId });
    if (data.pages.length > 0) {
      const rows = data.pages.map((p) =>
        this.pageRepository.create({
          userId,
          connectionId: connection!.id,
          pageId: p.pageId,
          pageName: p.pageName,
          pageAccessToken: p.pageAccessToken,
        }),
      );
      await this.pageRepository.save(rows);
    }
  }

  private expiryFromExpiresIn(expiresIn?: number): Date | null {
    if (!expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      return null;
    }
    return new Date(Date.now() + expiresIn * 1000);
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
      const message =
        body?.error?.message ??
        `Facebook API request failed (${res.status}).`;
      throw new BadRequestException(message);
    }

    return body;
  }
}
