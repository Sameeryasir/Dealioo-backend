import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';

export const GOOGLE_ADS_REQUIRED_SCOPE =
  'https://www.googleapis.com/auth/adwords';

export type GoogleBusinessCredentials = {
  accessToken: string;
  googleUserId: string;
  customerId: string | null;
  loginCustomerId: string;
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

  async assertBusinessGoogleToken(
    business: Business,
  ): Promise<{ accessToken: string; googleUserId: string }> {
    const googleUserId = business.googleUserId?.trim();
    const refreshToken = this.decryptRefreshToken(business);

    if (!googleUserId || !refreshToken) {
      throw new BadRequestException(
        'Google Ads is not connected. Connect Google in Settings → Integrations.',
      );
    }

    const accessToken = await this.getValidAccessToken(business, refreshToken);
    return { accessToken, googleUserId };
  }

  async assertBusinessGoogleCredentials(
    business: Business,
  ): Promise<GoogleBusinessCredentials> {
    const { accessToken, googleUserId } =
      await this.assertBusinessGoogleToken(business);

    if (!business.googleCustomerId?.trim()) {
      throw new BadRequestException(
        'No Google Ads account selected. Choose a Google Ads customer after connecting.',
      );
    }

    const scopes = (business.googleOauthScopes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.assertGoogleScopes(scopes);

    return {
      accessToken,
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
