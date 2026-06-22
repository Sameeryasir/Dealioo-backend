import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';

export const GOOGLE_ADS_REQUIRED_SCOPE =
  'https://www.googleapis.com/auth/adwords';

export type GoogleRestaurantCredentials = {
  accessToken: string;
  googleUserId: string;
  customerId: string | null;
};

type TokenRefreshResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

@Injectable()
export class GoogleAdsTokenService {
  private readonly logger = new Logger(GoogleAdsTokenService.name);

  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
  ) {}

  decryptRefreshToken(restaurant: Restaurant): string | null {
    const stored = restaurant.googleRefreshToken?.trim();
    if (!stored) return null;
    try {
      return decryptSecret(stored);
    } catch (err) {
      this.logger.error(
        `Refresh token decrypt failed for restaurant ${restaurant.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  assertGoogleScopes(scopes: string[]): void {
    const hasAdsScope = scopes.some(
      (scope) =>
        scope === GOOGLE_ADS_REQUIRED_SCOPE ||
        scope.includes('auth/adwords'),
    );
    if (!hasAdsScope) {
      throw new BadRequestException(
        'Google Ads permission missing. Reconnect and approve Google Ads access.',
      );
    }
  }

  async assertRestaurantGoogleToken(
    restaurant: Restaurant,
  ): Promise<{ accessToken: string; googleUserId: string }> {
    const googleUserId = restaurant.googleUserId?.trim();
    const refreshToken = this.decryptRefreshToken(restaurant);

    if (!googleUserId || !refreshToken) {
      throw new BadRequestException(
        'Google Ads is not connected. Connect Google in Settings → Integrations.',
      );
    }

    const accessToken = await this.getValidAccessToken(restaurant, refreshToken);
    return { accessToken, googleUserId };
  }

  async assertRestaurantGoogleCredentials(
    restaurant: Restaurant,
  ): Promise<GoogleRestaurantCredentials> {
    const { accessToken, googleUserId } =
      await this.assertRestaurantGoogleToken(restaurant);

    if (!restaurant.googleCustomerId?.trim()) {
      throw new BadRequestException(
        'No Google Ads account selected. Choose a Google Ads customer after connecting.',
      );
    }

    const scopes = (restaurant.googleOauthScopes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.assertGoogleScopes(scopes);

    return {
      accessToken,
      googleUserId,
      customerId: restaurant.googleCustomerId.trim(),
    };
  }

  async persistTokens(
    restaurantId: number,
    tokens: {
      accessToken: string;
      refreshToken?: string | null;
      expiresIn?: number | null;
      scopes?: string[];
    },
  ): Promise<void> {
    const expiresAt =
      tokens.expiresIn != null
        ? new Date(Date.now() + tokens.expiresIn * 1000)
        : null;

    await this.restaurantRepository.update(restaurantId, {
      googleAccessToken: encryptSecret(tokens.accessToken),
      googleTokenExpiresAt: expiresAt,
      ...(tokens.refreshToken?.trim()
        ? { googleRefreshToken: encryptSecret(tokens.refreshToken.trim()) }
        : {}),
      ...(tokens.scopes?.length
        ? { googleOauthScopes: tokens.scopes.join(',') }
        : {}),
    });
  }

  private async getValidAccessToken(
    restaurant: Restaurant,
    refreshToken: string,
  ): Promise<string> {
    const cached = restaurant.googleAccessToken?.trim();
    const expiresAt = restaurant.googleTokenExpiresAt?.getTime?.() ?? 0;

    if (cached && expiresAt > Date.now() + 60_000) {
      try {
        return decryptSecret(cached);
      } catch {
        /* fall through to refresh */
      }
    }

    const refreshed = await this.refreshAccessToken(refreshToken);

    await this.persistTokens(restaurant.id, {
      accessToken: refreshed.accessToken,
      expiresIn: refreshed.expiresIn,
      scopes: refreshed.scopes,
    });

    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number | null;
    scopes: string[];
  }> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });

    const json = (await res.json()) as TokenRefreshResponse;
    if (!res.ok || !json.access_token) {
      throw new BadRequestException(
        json.error_description ??
          json.error ??
          'Google access token expired. Disconnect and reconnect Google Ads in Settings → Integrations.',
      );
    }

    return {
      accessToken: json.access_token,
      expiresIn: json.expires_in ?? null,
      scopes: (json.scope ?? '').split(' ').filter(Boolean),
    };
  }

  getClientId(): string {
    const id = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!id) {
      throw new BadRequestException('GOOGLE_CLIENT_ID is not configured.');
    }
    return id;
  }

  getClientSecret(): string {
    const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!secret) {
      throw new BadRequestException('GOOGLE_CLIENT_SECRET is not configured.');
    }
    return secret;
  }

  getDeveloperToken(): string {
    const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
    if (!token) {
      throw new BadRequestException(
        'GOOGLE_ADS_DEVELOPER_TOKEN is not configured. Add your Google Ads API developer token to .env.',
      );
    }
    return token;
  }
}
