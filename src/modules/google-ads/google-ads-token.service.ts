import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';
import {
  GOOGLE_TAG_MANAGER_READONLY_SCOPE,
  refreshGoogleAccessToken,
} from './google-oauth.client';

export const GOOGLE_ADS_REQUIRED_SCOPE =
  'https://www.googleapis.com/auth/adwords';

export type GoogleBusinessCredentials = {
  accessToken: string;
  refreshToken: string;
  googleUserId: string;
  customerId: string | null;
  loginCustomerId: string;
};

@Injectable()
export class GoogleAdsTokenService {
  private readonly logger = new Logger(GoogleAdsTokenService.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
  ) {}

  decryptRefreshToken(business: Business): string | null {
    const stored = business.googleRefreshToken?.trim();
    if (!stored) return null;
    try {
      return decryptSecret(stored);
    } catch (err) {
      this.logger.error(
        `Refresh token decrypt failed for business ${business.id}: ${err instanceof Error ? err.message : String(err)}`,
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
        'Google Ads permission was not granted. Choose the Google account that owns your ads, approve Google Ads on the consent screen, then try again. If needed, remove this app at https://myaccount.google.com/permissions and reconnect.',
      );
    }
  }

  assertTagManagerScope(scopes: string[]): void {
    const hasGtmScope = scopes.some(
      (scope) =>
        scope === GOOGLE_TAG_MANAGER_READONLY_SCOPE ||
        scope.includes('auth/tagmanager.readonly') ||
        scope.includes('auth/tagmanager.edit.containers'),
    );
    if (!hasGtmScope) {
      throw new BadRequestException(
        'Google Tag Manager permission was not granted. Disconnect and reconnect Google Ads in Settings → Integrations, and approve Tag Manager access on the consent screen.',
      );
    }
  }

  async assertBusinessGoogleToken(
    business: Business,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    googleUserId: string;
  }> {
    const googleUserId = business.googleUserId?.trim();
    const refreshToken = this.decryptRefreshToken(business);

    if (!googleUserId || !refreshToken) {
      throw new BadRequestException(
        'Google Ads is not connected. Reconnect Google Ads in Settings → Integrations.',
      );
    }

    const accessToken = await this.getValidAccessToken(business, refreshToken);
    return { accessToken, refreshToken, googleUserId };
  }

  async assertBusinessGoogleCredentials(
    business: Business,
  ): Promise<GoogleBusinessCredentials> {
    const { accessToken, refreshToken, googleUserId } =
      await this.assertBusinessGoogleToken(business);

    if (!business.googleCustomerId?.trim()) {
      throw new BadRequestException(
        'No Google Ads account selected. Reconnect Google Ads in Settings → Integrations and choose a customer account.',
      );
    }

    const scopes = (business.googleOauthScopes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.assertGoogleScopes(scopes);

    return {
      accessToken,
      refreshToken,
      googleUserId,
      customerId: business.googleCustomerId.trim(),
      loginCustomerId:
        business.googleLoginCustomerId?.trim() ||
        business.googleCustomerId.trim(),
    };
  }

  async persistTokens(
    businessId: number,
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

    await this.businessRepository.update(businessId, {
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
    business: Business,
    refreshToken: string,
  ): Promise<string> {
    const cached = business.googleAccessToken?.trim();
    const expiresAt = business.googleTokenExpiresAt?.getTime?.() ?? 0;

    if (cached && expiresAt > Date.now() + 60_000) {
      try {
        return decryptSecret(cached);
      } catch {}
    }

    const refreshed = await this.refreshAccessToken(refreshToken);

    await this.persistTokens(business.id, {
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
    try {
      const credentials = await refreshGoogleAccessToken(refreshToken);
      if (!credentials.access_token) {
        throw new BadRequestException(
          'Google access token expired. Disconnect and reconnect Google Ads in Settings → Integrations.',
        );
      }

      const expiresIn =
        credentials.expiry_date != null
          ? Math.max(
              0,
              Math.floor((credentials.expiry_date - Date.now()) / 1000),
            )
          : null;

      return {
        accessToken: credentials.access_token,
        expiresIn,
        scopes: (credentials.scope ?? '').split(' ').filter(Boolean),
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'Google access token expired. Disconnect and reconnect Google Ads in Settings → Integrations.',
      );
    }
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
