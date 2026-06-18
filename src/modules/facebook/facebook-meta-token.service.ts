import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { decryptSecret } from '../../utils/token-encryption.util';

const FACEBOOK_GRAPH = 'https://graph.facebook.com/v23.0';

/** Required for any Meta Marketing API use (stats, ad accounts, campaigns). */
export const META_REQUIRED_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
] as const;

export type MetaRestaurantCredentials = {
  accessToken: string;
  metaUserId: string;
  adAccountId: string | null;
};

type DebugTokenData = {
  is_valid?: boolean;
  user_id?: string;
  app_id?: string;
  expires_at?: number;
  scopes?: string[];
  type?: string;
};

type DebugTokenResponse = {
  data?: DebugTokenData;
  error?: { message?: string };
};

/** Throws if any required advertising scope is missing from debug_token.scopes. */
export function assertMetaPermissions(scopes: string[]): void {
  const missing = META_REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));

  if (missing.length > 0) {
    throw new BadRequestException(
      `Meta permissions missing: ${missing.join(', ')}. Force reconnect required.`,
    );
  }
}

@Injectable()
export class FacebookMetaTokenService {
  private readonly logger = new Logger(FacebookMetaTokenService.name);

  decryptRestaurantToken(restaurant: Restaurant): string | null {
    const stored = restaurant.metaAccessToken?.trim();
    if (!stored) return null;
    try {
      return decryptSecret(stored);
    } catch (err) {
      this.logger.error(
        `Token decrypt failed for restaurant ${restaurant.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Validates a fresh OAuth token via debug_token before persisting to the database.
   * Never store a token unless this passes.
   */
  async validateAccessTokenForStorage(
    accessToken: string,
    metaUserId: string,
  ): Promise<{ grantedScopes: string[] }> {
    const debug = await this.debugUserAccessToken(accessToken);

    if (!debug?.is_valid) {
      throw new BadRequestException(
        'Meta returned an invalid access token. Approve all ad permissions and try again.',
      );
    }

    if (debug.user_id && debug.user_id !== metaUserId) {
      throw new BadRequestException(
        'Facebook user mismatch during login. Try connecting again.',
      );
    }

    if (debug.type && debug.type !== 'USER') {
      throw new BadRequestException(
        'Invalid Meta token type. Use Facebook Login, not an app token.',
      );
    }

    assertMetaPermissions(debug.scopes ?? []);

    return { grantedScopes: debug.scopes ?? [] };
  }

  /**
   * Validates stored user token via debug_token before any Meta Marketing API call.
   */
  async assertRestaurantMetaCredentials(
    restaurant: Restaurant,
  ): Promise<MetaRestaurantCredentials> {
    const accessToken = this.decryptRestaurantToken(restaurant);
    const metaUserId = restaurant.metaUserId?.trim();

    if (!accessToken || !metaUserId) {
      throw new BadRequestException(
        'Facebook is not connected. Connect Facebook in Settings → Integrations.',
      );
    }

    if (!restaurant.metaAdAccountId?.trim()) {
      throw new BadRequestException(
        'No Facebook ad account selected. Choose an ad account after connecting.',
      );
    }

    const debug = await this.debugUserAccessToken(accessToken);

    if (!debug?.is_valid) {
      throw new BadRequestException(
        'Meta access token is invalid or expired. Disconnect and reconnect Facebook in Settings → Integrations.',
      );
    }

    if (debug.user_id && debug.user_id !== metaUserId) {
      throw new BadRequestException(
        'Facebook token does not match this restaurant. Reconnect Facebook in Settings → Integrations.',
      );
    }

    if (debug.type && debug.type !== 'USER') {
      throw new BadRequestException(
        'Invalid Meta token type. Reconnect Facebook to refresh your login.',
      );
    }

    if (debug.expires_at && debug.expires_at > 0) {
      const expiresMs = debug.expires_at * 1000;
      if (Date.now() >= expiresMs) {
        throw new BadRequestException(
          'Meta access token expired. Reconnect Facebook in Settings → Integrations.',
        );
      }
    }

    assertMetaPermissions(debug.scopes ?? []);

    return {
      accessToken,
      metaUserId,
      adAccountId: restaurant.metaAdAccountId?.trim() ?? null,
    };
  }

  /** Validates token + scopes before listing ad accounts (no ad account selected yet). */
  async assertRestaurantMetaToken(
    restaurant: Restaurant,
  ): Promise<{ accessToken: string; metaUserId: string }> {
    const accessToken = this.decryptRestaurantToken(restaurant);
    const metaUserId = restaurant.metaUserId?.trim();

    if (!accessToken || !metaUserId) {
      throw new BadRequestException(
        'Facebook is not connected. Connect Facebook in Settings → Integrations.',
      );
    }

    const debug = await this.debugUserAccessToken(accessToken);

    if (!debug?.is_valid) {
      throw new BadRequestException(
        'Meta access token is invalid or expired. Reconnect Facebook in Settings → Integrations.',
      );
    }

    if (debug.user_id && debug.user_id !== metaUserId) {
      throw new BadRequestException(
        'Facebook token does not match this restaurant. Reconnect Facebook in Settings → Integrations.',
      );
    }

    assertMetaPermissions(debug.scopes ?? []);

    return { accessToken, metaUserId };
  }

  async debugUserAccessToken(accessToken: string): Promise<DebugTokenData | undefined> {
    const appId = process.env.FACEBOOK_APP_ID?.trim() || process.env.META_APP_ID?.trim();
    const appSecret =
      process.env.FACEBOOK_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim();

    if (!appId || !appSecret) {
      throw new BadRequestException('Facebook app credentials are not configured.');
    }

    const url = new URL(`${FACEBOOK_GRAPH}/debug_token`);
    url.searchParams.set('input_token', accessToken);
    url.searchParams.set('access_token', `${appId}|${appSecret}`);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(20_000),
    });

    const body = (await res.json()) as DebugTokenResponse;
    if (!res.ok || body.error) {
      throw new BadRequestException(
        body.error?.message ??
          'Could not validate Meta access token. Reconnect Facebook.',
      );
    }

    return body.data;
  }
}

/** Maps Meta OAuth / permission errors to a clear reconnect message. */
export function mapMetaMarketingApiError(
  message: string,
  errorCode?: number,
): string {
  const lower = message.toLowerCase();
  if (
    errorCode === 3 ||
    lower.includes('does not have the capability')
  ) {
    const appId =
      process.env.FACEBOOK_APP_ID?.trim() || process.env.META_APP_ID?.trim();
    const appHint = appId
      ? ` (App ID ${appId})`
      : '';
    return (
      `Meta blocked creating ads${appHint}: your app is in Development mode or lacks ads_management approval. ` +
      'In Meta Developer Console → your app → App roles, add your Facebook account as Administrator, ' +
      'then disconnect and reconnect Facebook in Settings → Integrations.'
    );
  }
  if (lower.includes('meta permissions missing')) {
    return `${message} Open Settings → Integrations → Connect with Facebook and approve ads_management, ads_read, and business_management.`;
  }
  if (
    lower.includes('cannot call api for app') &&
    lower.includes('on behalf of user')
  ) {
    return (
      'Meta blocked this action for your Facebook user. Add your Facebook account as a Tester/Developer on the OnlyDeals Meta app, complete Marketing API testing, then reconnect Facebook in Settings → Integrations with ads permissions.'
    );
  }
  if (lower.includes('permission') || lower.includes('oauth')) {
    return `${message} Reconnect Facebook in Settings → Integrations.`;
  }
  return message;
}
