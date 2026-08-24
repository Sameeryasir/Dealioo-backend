import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { google } from 'googleapis';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { encryptSecret } from '../../utils/token-encryption.util';
import { AdminNotificationWriter } from '../admin-notifications/admin-notifications.writer';
import { requireAdminRole } from '../../utils/require-admin-role';
import { businessAccessWhere } from '../../utils/business-access';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { GoogleAdsCampaignStatsDto } from './dto/google-ads-campaign-stats.dto';
import {
  GoogleAdsConversionGoalDto,
  GoogleAdsConversionGoalsResponseDto,
} from './dto/google-ads-conversion-goals.dto';
import { GoogleAdsBusinessProfileDto } from './dto/google-ads-business-profile.dto';
import { GoogleAdsConnectionStatusDto } from './dto/google-ads-connection-status.dto';
import { GoogleAdsCustomerDto } from './dto/google-ads-customer.dto';
import { GoogleTagManagerContainerDto } from './dto/google-tag-manager-container.dto';
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
import {
  buildGoogleOAuthConnectUrl,
  createGoogleOAuth2Client,
  exchangeGoogleAuthCode,
  fetchGoogleOAuthUserInfo,
  GOOGLE_OAUTH_SCOPES,
} from './google-oauth.client';
import {
  createGoogleAdsApiClient,
  createGoogleAdsCustomer,
  formatGoogleAdsSdkError,
  fromMicros,
  ResourceNames,
} from './google-ads-sdk.client';
import { enums } from 'google-ads-api';

const GOOGLE_AD_STATS_DATE_PRESET = 'LAST_30_DAYS';
const GOOGLE_ADS_SDK_TIMEOUT_MS = 12_000;

function buildEnumNameByNumber(enumObject: Record<string, string | number>) {
  const byNumber = new Map<number, string>();
  for (const [key, value] of Object.entries(enumObject)) {
    if (typeof value === 'number' && Number.isFinite(value) && !/^\d+$/.test(key)) {
      byNumber.set(value, key);
    }
  }
  return byNumber;
}

const CONVERSION_CATEGORY_BY_NUMBER = buildEnumNameByNumber(
  enums.ConversionActionCategory as unknown as Record<string, string | number>,
);
const CONVERSION_ORIGIN_BY_NUMBER = buildEnumNameByNumber(
  enums.ConversionOrigin as unknown as Record<string, string | number>,
);
const ASSET_FIELD_TYPE_BY_NUMBER = buildEnumNameByNumber(
  enums.AssetFieldType as unknown as Record<string, string | number>,
);

type GoogleAdsSearchRow = {
  campaign?: {
    id?: string | number;
    name?: string;
    status?: string | number;
  };
  metrics?: {
    costMicros?: string | number;
    cost_micros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
    conversions_value?: string | number;
  };
  customer?: {
    descriptiveName?: string;
    descriptive_name?: string;
    currencyCode?: string;
    currency_code?: string;
    manager?: boolean;
  };
  customerConversionGoal?: {
    category?: string | number;
    origin?: string | number;
    biddable?: boolean;
  };
  customer_conversion_goal?: {
    category?: string | number;
    origin?: string | number;
    biddable?: boolean;
  };
  conversionAction?: {
    name?: string;
    category?: string | number;
    origin?: string | number;
    status?: string | number;
  };
  conversion_action?: {
    name?: string;
    category?: string | number;
    origin?: string | number;
    status?: string | number;
  };
  customerAsset?: {
    fieldType?: string | number;
    field_type?: string | number;
    status?: string | number;
  };
  customer_asset?: {
    fieldType?: string | number;
    field_type?: string | number;
    status?: string | number;
  };
  campaignAsset?: {
    fieldType?: string | number;
    field_type?: string | number;
    status?: string | number;
  };
  campaign_asset?: {
    fieldType?: string | number;
    field_type?: string | number;
    status?: string | number;
  };
  assetGroupAsset?: {
    fieldType?: string | number;
    field_type?: string | number;
    status?: string | number;
  };
  asset_group_asset?: {
    fieldType?: string | number;
    field_type?: string | number;
    status?: string | number;
  };
  asset?: {
    name?: string;
    type?: string | number;
    id?: string | number;
    resourceName?: string;
    resource_name?: string;
    textAsset?: { text?: string };
    text_asset?: { text?: string };
    imageAsset?: {
      fullSize?: { url?: string; heightPixels?: number; widthPixels?: number };
      full_size?: { url?: string; height_pixels?: number; width_pixels?: number };
    };
    image_asset?: {
      fullSize?: { url?: string; heightPixels?: number; widthPixels?: number };
      full_size?: { url?: string; height_pixels?: number; width_pixels?: number };
    };
    structuredSnippetAsset?: {
      header?: string;
      values?: string[];
    };
    structured_snippet_asset?: {
      header?: string;
      values?: string[];
    };
  };
};

type GoogleAdsCustomerClientRow = {
  customerClient?: {
    id?: string | number;
    descriptiveName?: string;
    descriptive_name?: string;
    currencyCode?: string;
    currency_code?: string;
    manager?: boolean;
    level?: string | number;
    status?: string | number;
  };
  customer_client?: {
    id?: string | number;
    descriptiveName?: string;
    descriptive_name?: string;
    currencyCode?: string;
    currency_code?: string;
    manager?: boolean;
    level?: string | number;
    status?: string | number;
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
    private readonly adminNotificationWriter: AdminNotificationWriter,
  ) {}

  async connect(user: User, businessId: number): Promise<{ url: string }> {
    requireAdminRole(
      user,
      'You do not have permission to connect Google Ads for this account.',
    );

    const business = await this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
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
    const clientSecret = this.tokenService.getClientSecret();
    const redirectUri = this.getRedirectUri();

    this.logger.log(
      `Google OAuth connect URL business=${businessId} redirectUri=${redirectUri} requestedScopes=${GOOGLE_OAUTH_SCOPES.join(' ')}`,
    );

    try {
      const url = buildGoogleOAuthConnectUrl({
        redirectUri,
        state: createGoogleOAuthState(businessId, clientSecret),
      });
      return { url };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is not configured.',
      );
    }
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

      
      this.logger.log(
        `Google OAuth grantedScope (callback query) business=${businessId}: ${grantedScope ?? '(empty)'}`,
      );

      const callbackScopes = this.parseScopeList(grantedScope);
      this.logger.log(
        `Google OAuth parsed callbackScopes business=${businessId}: ${JSON.stringify(callbackScopes)}`,
      );
      
      

      const business = await this.businessRepository.findOne({
        where: { id: businessId },
        relations: ['owner'],
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
        this.parseScopeList(tokenJson.scope ?? undefined),
      );
      this.logger.log(
        `Google OAuth scopes after token exchange business=${businessId}: callback=${JSON.stringify(callbackScopes)} token=${JSON.stringify(this.parseScopeList(tokenJson.scope ?? undefined))} merged=${JSON.stringify(grantedScopes)}`,
      );
      this.tokenService.assertGoogleScopes(grantedScopes);

      const tokenExpiresAt =
        tokenJson.expiry_date != null
          ? new Date(tokenJson.expiry_date)
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

      this.logger.log(
        `Google Ads connected for business ${businessId} (user ${googleUserId})`,
      );

      await this.adminNotificationWriter.notifyIntegrationConnected({
        provider: 'google',
        businessId,
        businessName: business.name,
        actorUserId: business.owner?.id ?? null,
        idempotencyKey: `google_connected:${businessId}:${googleUserId}`,
        metadata: { googleUserId, grantedScopes },
      });

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
        const failedBusiness = await this.businessRepository.findOne({
          where: { id: businessId },
          relations: ['owner'],
        });
        await this.adminNotificationWriter.notifyIntegrationFailed({
          provider: 'google',
          businessId,
          businessName:
            failedBusiness?.name?.trim() || `Business #${businessId}`,
          reason: err instanceof Error ? err.message : String(err),
          actorUserId: failedBusiness?.owner?.id ?? null,
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
    const { refreshToken } =
      await this.tokenService.assertBusinessGoogleToken(business);

    const scopes = (business.googleOauthScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    this.tokenService.assertGoogleScopes(scopes);

    const customers = await this.listAccessibleCustomers(refreshToken);

    await this.auditService.log(businessId, 'customers_fetched', {
      status: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
      metadata: { count: customers.length },
    });

    return customers;
  }

  async listGtmContainersForBusiness(
    user: User,
    businessId: number,
  ): Promise<GoogleTagManagerContainerDto[]> {
    requireAdminRole(
      user,
      'You do not have permission to list Google Tag Manager containers.',
    );

    const business = await this.loadOwnedBusiness(user, businessId);
    const { accessToken } =
      await this.tokenService.assertBusinessGoogleToken(business);

    const scopes = (business.googleOauthScopes ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    this.tokenService.assertTagManagerScope(scopes);

    const containers = await this.fetchGtmContainers(accessToken, businessId);

    this.logger.log(
      `GTM containers businessId=${businessId} googleUserId=${business.googleUserId ?? 'unknown'} count=${containers.length} scopes=${scopes.join(',')}`,
    );

    await this.auditService.log(businessId, 'gtm_containers_fetched', {
      status: GoogleAdsConnectionStatus.TOKEN_EXCHANGED,
      metadata: {
        count: containers.length,
        googleUserId: business.googleUserId ?? null,
        scopes,
      },
    });

    return containers;
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
    const { refreshToken } =
      await this.tokenService.assertBusinessGoogleToken(business);

    const normalizedId = this.normalizeCustomerId(customerId);
    const loginCustomerId = managerCustomerId?.trim()
      ? this.normalizeCustomerId(managerCustomerId)
      : normalizedId;

    let connectedAccount = 'Google Ads account';
    try {
      const customerMeta = await this.fetchCustomerMeta(
        refreshToken,
        normalizedId,
        loginCustomerId,
      );
      if (customerMeta.name?.trim()) {
        connectedAccount = customerMeta.name.trim();
      }
    } catch (err) {
      throw new BadRequestException(
        formatGoogleAdsSdkError(
          err,
          'That Google Ads account is not available for this Google login. Pick one from the list.',
        ),
      );
    }

    await this.businessRepository.update(businessId, {
      googleCustomerId: normalizedId,
      googleLoginCustomerId: loginCustomerId,
      googleConnectionStatus: GoogleAdsConnectionStatus.CUSTOMER_SELECTED,
    });

    await this.auditService.log(businessId, 'google_ads_connected', {
      status: GoogleAdsConnectionStatus.CUSTOMER_SELECTED,
      metadata: { connectedAccount },
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
      metadata: { connectedAccount: 'Google Ads was removed' },
    });

    this.logger.log(
      `Google Ads disconnected for business ${businessId}`,
    );

    return { disconnected: true };
  }

  async getAdCampaignStats(
    business: Business,
  ): Promise<GoogleAdsCampaignStatsDto> {
    const { refreshToken, customerId, loginCustomerId } =
      await this.tokenService.assertBusinessGoogleCredentials(business);

    const [customerMeta, campaigns] = await Promise.all([
      this.fetchCustomerMeta(refreshToken, customerId!, loginCustomerId),
      this.fetchCampaignStats(refreshToken, customerId!, loginCustomerId),
    ]);

    return {
      customerId,
      customerName: customerMeta.name,
      currency: customerMeta.currency,
      datePreset: GOOGLE_AD_STATS_DATE_PRESET,
      campaigns,
    };
  }

  async getConversionGoals(
    business: Business,
  ): Promise<GoogleAdsConversionGoalsResponseDto> {
    const { refreshToken, customerId, loginCustomerId } =
      await this.tokenService.assertBusinessGoogleCredentials(business);

    const goals = await this.fetchConversionGoals(
      refreshToken,
      customerId!,
      loginCustomerId,
    );

    return {
      customerId,
      goals,
    };
  }

  /**
   * Change summary: returns business name + inferred category from connected Ads.
   * Why: Campaign information prefills from Ads (phone lookup reverted).
   * Related: GoogleAdsController GET ads/business-profile/:businessId
   */
  async getAdsBusinessProfile(
    business: Business,
  ): Promise<GoogleAdsBusinessProfileDto> {
    const { refreshToken, customerId, loginCustomerId } =
      await this.tokenService.assertBusinessGoogleCredentials(business);

    try {
      return await this.fetchAdsBusinessProfile(
        refreshToken,
        customerId!,
        loginCustomerId,
      );
    } catch (err) {
      this.logger.warn(
        `Google Ads business profile failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        customerId: customerId ?? null,
        businessName: null,
        businessCategory: null,
        websiteUrl: null,
      };
    }
  }

  private async fetchAdsBusinessProfile(
    refreshToken: string,
    customerId: string,
    loginCustomerId: string = customerId,
  ): Promise<GoogleAdsBusinessProfileDto> {
    let businessName: string | null = null;
    const categoryHints: string[] = [];

    try {
      const customerMeta = await this.fetchCustomerMeta(
        refreshToken,
        customerId,
        loginCustomerId,
      );
      businessName = customerMeta.name;
    } catch (err) {
      this.logger.warn(
        `Google Ads customer meta for business profile failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    try {
      const brandRows = await this.searchAdsBrandTextRows(
        refreshToken,
        customerId,
        loginCustomerId,
      );

      for (const row of brandRows) {
        const link =
          row.customerAsset ??
          row.customer_asset ??
          row.campaignAsset ??
          row.campaign_asset ??
          row.assetGroupAsset ??
          row.asset_group_asset;
        const asset = row.asset;
        const fieldType = this.normalizeAssetFieldType(
          link?.fieldType ?? link?.field_type,
        );
        const text =
          asset?.textAsset?.text?.trim() ||
          asset?.text_asset?.text?.trim() ||
          null;
        const snippet =
          asset?.structuredSnippetAsset ?? asset?.structured_snippet_asset;
        const snippetHeader = snippet?.header?.trim() || '';
        const snippetValues = Array.isArray(snippet?.values)
          ? snippet.values.map((v) => String(v || '').trim()).filter(Boolean)
          : [];

        if (fieldType === 'BUSINESS_NAME' && text) {
          businessName = text;
        }

        if (
          fieldType === 'STRUCTURED_SNIPPET' &&
          /^(types?|services?|brands?|styles?)$/i.test(snippetHeader)
        ) {
          categoryHints.push(...snippetValues);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Google Ads brand text lookup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (businessName) {
      categoryHints.unshift(businessName);
    }

    return {
      customerId,
      businessName,
      businessCategory: this.inferBusinessCategoryFromAdsHints(categoryHints),
      websiteUrl: null,
    };
  }

  private async searchAdsBrandTextRows(
    refreshToken: string,
    customerId: string,
    loginCustomerId: string,
  ): Promise<GoogleAdsSearchRow[]> {
    return this.searchAdsAssetLinkRows(
      refreshToken,
      customerId,
      loginCustomerId,
      `
      asset.name,
      asset.text_asset.text,
      asset.structured_snippet_asset.header,
      asset.structured_snippet_asset.values
      `.trim(),
      `field_type IN ('BUSINESS_NAME', 'STRUCTURED_SNIPPET')`,
      ['customer_asset'],
    );
  }

  private async searchAdsAssetLinkRows(
    refreshToken: string,
    customerId: string,
    loginCustomerId: string,
    assetSelect: string,
    fieldTypeFilter: string,
    resources: Array<'customer_asset' | 'campaign_asset' | 'asset_group_asset'> = [
      'customer_asset',
      'campaign_asset',
      'asset_group_asset',
    ],
  ): Promise<GoogleAdsSearchRow[]> {
    const queryByResource: Record<string, string> = {
      customer_asset: `
      SELECT
        customer_asset.field_type,
        ${assetSelect}
      FROM customer_asset
      WHERE customer_asset.status != 'REMOVED'
        AND customer_asset.${fieldTypeFilter}
      `.trim(),
      campaign_asset: `
      SELECT
        campaign_asset.field_type,
        ${assetSelect}
      FROM campaign_asset
      WHERE campaign_asset.status != 'REMOVED'
        AND campaign_asset.${fieldTypeFilter}
      `.trim(),
      asset_group_asset: `
      SELECT
        asset_group_asset.field_type,
        ${assetSelect}
      FROM asset_group_asset
      WHERE asset_group_asset.status != 'REMOVED'
        AND asset_group_asset.${fieldTypeFilter}
      `.trim(),
    };

    const settled = await Promise.all(
      resources.map(async (resource) => {
        try {
          return await this.googleAdsSearch<GoogleAdsSearchRow>(
            refreshToken,
            customerId,
            queryByResource[resource],
            loginCustomerId,
          );
        } catch (err) {
          this.logger.warn(
            `Google Ads ${resource} lookup failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return [] as GoogleAdsSearchRow[];
        }
      }),
    );

    return settled.flat();
  }

  /**
   * Maps Ads account signals (name + structured snippet values) onto our
   * Campaign Information category options. Google Ads has no single category field.
   */
  private inferBusinessCategoryFromAdsHints(hints: string[]): string | null {
    const haystack = hints.join(' ').toLowerCase();
    if (!haystack.trim()) {
      return null;
    }

    const rules: Array<{ category: string; needles: string[] }> = [
      {
        category: 'Food & Dining',
        needles: [
          'restaurant',
          'cafe',
          'coffee',
          'food',
          'dining',
          'pizza',
          'bakery',
          'bar ',
          'grill',
        ],
      },
      {
        category: 'Retail',
        needles: [
          'retail',
          'shop',
          'store',
          'boutique',
          'ecommerce',
          'e-commerce',
          'marketplace',
        ],
      },
      {
        category: 'Health & Wellness',
        needles: [
          'clinic',
          'dental',
          'doctor',
          'health',
          'wellness',
          'medical',
          'pharmacy',
          'fitness',
          'gym',
        ],
      },
      {
        category: 'Beauty & Personal Care',
        needles: [
          'salon',
          'spa',
          'beauty',
          'barber',
          'nail',
          'skincare',
          'hair',
        ],
      },
      {
        category: 'Home Services',
        needles: [
          'plumb',
          'hvac',
          'electric',
          'roof',
          'cleaning',
          'landscap',
          'handyman',
          'home service',
          'repair',
        ],
      },
      {
        category: 'Professional Services',
        needles: [
          'law',
          'attorney',
          'accountant',
          'consult',
          'agency',
          'insurance',
          'finance',
          'legal',
        ],
      },
      {
        category: 'Travel & Hospitality',
        needles: [
          'hotel',
          'travel',
          'tour',
          'motel',
          'resort',
          'hospitality',
          'airbnb',
        ],
      },
      {
        category: 'Automotive',
        needles: [
          'auto',
          'car ',
          'vehicle',
          'dealer',
          'mechanic',
          'garage',
          'tire',
        ],
      },
      {
        category: 'Education',
        needles: [
          'school',
          'tutor',
          'education',
          'university',
          'college',
          'course',
          'training',
        ],
      },
      {
        category: 'Technology',
        needles: [
          'software',
          'saas',
          'tech',
          'it ',
          'digital',
          'app ',
          'cloud',
          'cyber',
        ],
      },
    ];

    for (const rule of rules) {
      if (rule.needles.some((needle) => haystack.includes(needle))) {
        return rule.category;
      }
    }

    return 'Other';
  }

  private normalizeAssetFieldType(
    value: string | number | null | undefined,
  ): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return ASSET_FIELD_TYPE_BY_NUMBER.get(value) ?? '';
    }
    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        return ASSET_FIELD_TYPE_BY_NUMBER.get(Number(trimmed)) ?? '';
      }
      return trimmed.toUpperCase();
    }
    return '';
  }

  private async fetchConversionGoals(
    refreshToken: string,
    customerId: string,
    loginCustomerId: string = customerId,
  ): Promise<GoogleAdsConversionGoalDto[]> {
    const goalQuery = `
      SELECT
        customer_conversion_goal.category,
        customer_conversion_goal.origin,
        customer_conversion_goal.biddable
      FROM customer_conversion_goal
    `.trim();

    const actionQuery = `
      SELECT
        conversion_action.name,
        conversion_action.category,
        conversion_action.origin,
        conversion_action.status
      FROM conversion_action
      WHERE conversion_action.status = 'ENABLED'
    `.trim();

    const [goalRows, actionRows] = await Promise.all([
      this.googleAdsSearch<GoogleAdsSearchRow>(
        refreshToken,
        customerId,
        goalQuery,
        loginCustomerId,
      ),
      this.googleAdsSearch<GoogleAdsSearchRow>(
        refreshToken,
        customerId,
        actionQuery,
        loginCustomerId,
      ),
    ]);

    const actionCounts = new Map<string, number>();
    for (const row of actionRows) {
      const action = row.conversionAction ?? row.conversion_action;
      const category = this.normalizeConversionCategory(action?.category);
      const origin = this.normalizeConversionOrigin(action?.origin);
      if (!category || !origin) {
        continue;
      }
      const key = `${category}::${origin}`;
      actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1);
    }

    const goals: GoogleAdsConversionGoalDto[] = [];
    for (const row of goalRows) {
      const goal = row.customerConversionGoal ?? row.customer_conversion_goal;
      const category = this.normalizeConversionCategory(goal?.category);
      const origin = this.normalizeConversionOrigin(goal?.origin);
      if (!category || !origin) {
        continue;
      }

      const key = `${category}::${origin}`;
      const actionCount = actionCounts.get(key) ?? 0;
      if (actionCount < 1) {
        continue;
      }

      const accountDefault = goal?.biddable === true;
      goals.push({
        category,
        origin,
        name: this.conversionCategoryLabel(category),
        sourceLabel: this.conversionOriginLabel(origin),
        actionCount,
        accountDefault,
      });
    }

    goals.sort((left, right) => {
      if (left.accountDefault !== right.accountDefault) {
        return left.accountDefault ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    return goals;
  }

  private normalizeConversionCategory(
    value: string | number | null | undefined,
  ): string {
    return this.normalizeGoogleAdsEnum(value, CONVERSION_CATEGORY_BY_NUMBER);
  }

  private normalizeConversionOrigin(
    value: string | number | null | undefined,
  ): string {
    return this.normalizeGoogleAdsEnum(value, CONVERSION_ORIGIN_BY_NUMBER);
  }

  private normalizeGoogleAdsEnum(
    value: string | number | null | undefined,
    byNumber: Map<number, string>,
  ): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return byNumber.get(value) ?? '';
    }
    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        return byNumber.get(Number(trimmed)) ?? '';
      }
      return trimmed.toUpperCase();
    }
    return '';
  }

  private conversionCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      PURCHASE: 'Purchases',
      ADD_TO_CART: 'Add to cart',
      BEGIN_CHECKOUT: 'Begin checkout',
      SUBSCRIBE_PAID: 'Paid subscriptions',
      PAGE_VIEW: 'Page views',
      LEAD: 'Leads',
      SIGNUP: 'Sign-ups',
      CONTACT: 'Contacts',
      SUBMIT_LEAD_FORM: 'Submit lead form',
      BOOK_APPOINTMENT: 'Book appointment',
      REQUEST_QUOTE: 'Request quote',
      GET_DIRECTIONS: 'Get directions',
      OUTBOUND_CLICK: 'Outbound clicks',
      PHONE_CALL_LEAD: 'Phone call leads',
      STORE_SALE: 'Store sales',
      STORE_VISIT: 'Store visits',
      ENGAGEMENT: 'Engagements',
      IMPORTED_LEAD: 'Imported leads',
      QUALIFIED_LEAD: 'Qualified leads',
      CONVERTED_LEAD: 'Converted leads',
      DEFAULT: 'Default',
      UNKNOWN: 'Unknown',
      UNSPECIFIED: 'Unspecified',
    };
    return labels[category] ?? category.replace(/_/g, ' ').toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private conversionOriginLabel(origin: string): string {
    const labels: Record<string, string> = {
      WEBSITE: 'Website',
      GOOGLE_HOSTED: 'Google hosted',
      APP: 'App',
      CALL_FROM_ADS: 'Calls from ads',
      STORE: 'Store',
      YOUTUBE_HOSTED: 'YouTube hosted',
      UNKNOWN: 'Unknown',
      UNSPECIFIED: 'Unspecified',
    };
    return labels[origin] ?? origin.replace(/_/g, ' ').toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  async deleteCampaignForBusiness(
    user: User,
    businessId: number,
    googleCampaignId: string,
  ): Promise<{ deleted: true; googleCampaignId: string }> {
    const campaignId = String(googleCampaignId ?? '').replace(/\D/g, '');
    if (!campaignId) {
      throw new BadRequestException('Google campaign id is required.');
    }

    const business = await this.loadOwnedBusiness(user, businessId);
    const { refreshToken, customerId, loginCustomerId } =
      await this.tokenService.assertBusinessGoogleCredentials(business);

    const normalizedCustomerId = this.normalizeCustomerId(customerId!);
    const normalizedLoginCustomerId = loginCustomerId
      ? this.normalizeCustomerId(loginCustomerId)
      : normalizedCustomerId;

    const client = this.getGoogleAdsApiClient();
    const customer = createGoogleAdsCustomer(client, {
      customerId: normalizedCustomerId,
      refreshToken,
      loginCustomerId: normalizedLoginCustomerId,
    });

    const resourceName = ResourceNames.campaign(
      normalizedCustomerId,
      campaignId,
    );

    try {
      await this.withSdkTimeout(
        customer.campaigns.remove([resourceName]),
        'googleAds:deleteCampaign',
      );
    } catch (err) {
      throw new BadRequestException(
        formatGoogleAdsSdkError(
          err,
          'Could not delete Google Ads campaign. Try again or remove it in Google Ads.',
        ),
      );
    }

    this.logger.log(
      `Google Ads campaign ${campaignId} deleted for business ${businessId}`,
    );

    return { deleted: true, googleCampaignId: campaignId };
  }

  private async fetchCampaignStats(
    refreshToken: string,
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
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
    `.trim();

    const rows = await this.googleAdsSearch<GoogleAdsSearchRow>(
      refreshToken,
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
        conversionValue: number;
      }
    >();

    for (const row of rows) {
      const id = String(row.campaign?.id ?? '').replace(/\D/g, '');
      if (!id) continue;

      const existing = aggregated.get(id) ?? {
        id,
        name: row.campaign?.name?.trim() || 'Unnamed campaign',
        status: this.normalizeEnumValue(row.campaign?.status),
        costMicros: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
      };

      existing.costMicros += this.toNumber(
        row.metrics?.costMicros ?? row.metrics?.cost_micros,
      );
      existing.impressions += this.toNumber(row.metrics?.impressions);
      existing.clicks += this.toNumber(row.metrics?.clicks);
      existing.conversions += this.toNumber(row.metrics?.conversions);
      existing.conversionValue += this.toNumber(
        row.metrics?.conversionsValue ?? row.metrics?.conversions_value,
      );

      aggregated.set(id, existing);
    }

    return [...aggregated.values()].map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      effectiveStatus: row.status,
      dailyBudget: null,
      insights: {
        spend: String(fromMicros(row.costMicros)),
        impressions: String(row.impressions),
        clicks: String(row.clicks),
        conversions: String(row.conversions),
        conversionValue: String(row.conversionValue),
      },
    }));
  }

  private async fetchCustomerMeta(
    refreshToken: string,
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
      refreshToken,
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
    refreshToken: string,
    customerId: string,
    loginCustomerId: string,
  ): Promise<{
    name: string | null;
    currency: string | null;
    isManager: boolean;
    inaccessible?: boolean;
  } | null> {
    try {
      return await this.fetchCustomerMeta(
        refreshToken,
        customerId,
        loginCustomerId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug(
        `Google Ads customer meta lookup failed (customer=${customerId}, login=${loginCustomerId}): ${message}`,
      );
      if (
        message.includes('not yet enabled') ||
        message.includes('has been deactivated') ||
        message.includes('timed out')
      ) {
        return {
          name: null,
          currency: null,
          isManager: false,
          inaccessible: true,
        };
      }
      return null;
    }
  }

  private async enrichAccessibleCustomers(
    refreshToken: string,
    ids: string[],
  ): Promise<GoogleAdsCustomerDto[]> {
    if (ids.length === 0) {
      return [];
    }

    const metaById = new Map<
      string,
      { name: string | null; currency: string | null; isManager: boolean }
    >();
    const inaccessibleIds = new Set<string>();

    const firstPass = await Promise.all(
      ids.map(async (id) => {
        const meta = await this.tryFetchCustomerMeta(refreshToken, id, id);
        return { id, meta };
      }),
    );

    for (const { id, meta } of firstPass) {
      if (!meta) {
        continue;
      }
      if (meta.inaccessible) {
        inaccessibleIds.add(id);
      }
      metaById.set(id, {
        name: meta.name,
        currency: meta.currency,
        isManager: meta.isManager,
      });
    }

    const managerIds = ids.filter((id) => metaById.get(id)?.isManager);

    const needsLoginRetry = ids.filter((id) => {
      if (inaccessibleIds.has(id)) {
        return false;
      }
      const existing = metaById.get(id);
      return !existing?.name;
    });

    if (needsLoginRetry.length > 0 && managerIds.length > 0) {
      await Promise.all(
        needsLoginRetry.map(async (id) => {
          const existing = metaById.get(id);
          for (const loginId of managerIds) {
            if (loginId === id) {
              continue;
            }
            const meta = await this.tryFetchCustomerMeta(
              refreshToken,
              id,
              loginId,
            );
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
        }),
      );
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
    refreshToken: string,
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
        refreshToken,
        managerCustomerId,
        query,
        managerCustomerId,
      );

      const clients: GoogleAdsCustomerDto[] = [];

      for (const row of rows) {
        const client = row.customerClient ?? row.customer_client;
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
          status: this.normalizeEnumValue(client?.status),
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
    refreshToken: string,
    rootIds: string[],
  ): Promise<GoogleAdsCustomerDto[]> {
    const enriched = await this.enrichAccessibleCustomers(refreshToken, rootIds);
    const byId = new Map(enriched.map((customer) => [customer.id, customer]));

    const managerIds = enriched
      .filter((customer) => customer.isManager)
      .map((customer) => customer.id);

    const childrenLists = await Promise.all(
      managerIds.map((id) => this.fetchDirectClientAccounts(refreshToken, id)),
    );

    for (const children of childrenLists) {
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
    refreshToken: string,
  ): Promise<GoogleAdsCustomerDto[]> {
    const client = this.getGoogleAdsApiClient();

    try {
      const response = (await this.withSdkTimeout(
        client.listAccessibleCustomers(refreshToken),
        'listAccessibleCustomers',
      )) as { resource_names?: string[] | null };
      const resourceNames = response.resource_names ?? [];
      const ids = resourceNames
        .map((name) => name.replace(/^customers\//, '').trim())
        .filter(Boolean);

      return this.buildFullCustomerList(refreshToken, ids);
    } catch (err) {
      throw new BadRequestException(
        formatGoogleAdsSdkError(
          err,
          'Could not list Google Ads accounts. Check your developer token, enable Google Ads API in Google Cloud Console, and reconnect.',
        ),
      );
    }
  }

  private async fetchGtmContainers(
    accessToken: string,
    businessId?: number,
  ): Promise<GoogleTagManagerContainerDto[]> {
    const auth = createGoogleOAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    const tagmanager = google.tagmanager({ version: 'v2', auth });

    try {
      const accountsRes = await tagmanager.accounts.list({
        includeGoogleTags: true,
      });
      const accounts = accountsRes.data.account ?? [];
      const byPublicId = new Map<string, GoogleTagManagerContainerDto>();

      this.logger.log(
        `GTM accounts.list businessId=${businessId ?? 'unknown'} accountCount=${accounts.length}`,
      );

      if (accounts.length === 0) {
        this.logger.warn(
          `GTM accounts.list returned no accounts for businessId=${businessId ?? 'unknown'}. The connected Google user may have no Tag Manager access, or no GTM accounts exist yet.`,
        );
      }

      for (const account of accounts) {
        const accountPath =
          account.path?.trim() ||
          (account.accountId != null
            ? `accounts/${String(account.accountId).trim()}`
            : '');
        const accountId = String(account.accountId ?? '').trim();

        if (!accountPath || !accountId) {
          this.logger.warn(
            `GTM account skipped businessId=${businessId ?? 'unknown'} missing accountId/path`,
          );
          continue;
        }

        this.logger.log(
          `GTM containers.list businessId=${businessId ?? 'unknown'} parent=${accountPath} accountName=${account.name ?? 'unknown'}`,
        );

        const containersRes = await tagmanager.accounts.containers.list({
          parent: accountPath,
        });
        const containerRows = containersRes.data.container ?? [];

        this.logger.log(
          `GTM containers.list businessId=${businessId ?? 'unknown'} parent=${accountPath} containerCount=${containerRows.length}`,
        );

        for (const container of containerRows) {
          const publicId = container.publicId?.trim();
          if (!publicId) continue;

          byPublicId.set(publicId, {
            id: publicId,
            name: container.name?.trim() || null,
            accountId,
            accountName: account.name?.trim() || null,
            containerId: container.containerId
              ? String(container.containerId)
              : null,
          });
        }
      }

      const containers = [...byPublicId.values()].sort((a, b) =>
        (a.name ?? a.id).localeCompare(b.name ?? b.id),
      );

      if (containers.length === 0 && accounts.length > 0) {
        this.logger.warn(
          `GTM returned accounts but no containers for businessId=${businessId ?? 'unknown'}. Create a container at tagmanager.google.com for the connected Google account.`,
        );
      }

      return containers;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;

      const gaxios = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
      };
      const status = gaxios.response?.status;
      const responseData = gaxios.response?.data;
      const message = err instanceof Error ? err.message : String(err);

      this.logger.error(
        `GTM containers list failed businessId=${businessId ?? 'unknown'} status=${status ?? 'unknown'} message=${message} response=${JSON.stringify(responseData ?? null)}`,
      );

      if (
        status === 403 ||
        /insufficient|ACCESS_TOKEN_SCOPE|403|PERMISSION/i.test(message)
      ) {
        throw new BadRequestException(
          'Could not list Google Tag Manager containers. Disconnect and reconnect Google Ads in Settings → Integrations, approve Tag Manager access on the consent screen, and enable Tag Manager API in Google Cloud Console.',
        );
      }

      throw new BadRequestException(
        'Could not list Google Tag Manager containers. Enable Tag Manager API in Google Cloud Console, then reconnect Google Ads.',
      );
    }
  }

  private async googleAdsSearch<T>(
    refreshToken: string,
    customerId: string,
    query: string,
    loginCustomerId?: string,
  ): Promise<T[]> {
    const normalizedCustomerId = this.normalizeCustomerId(customerId);
    const normalizedLoginCustomerId = loginCustomerId
      ? this.normalizeCustomerId(loginCustomerId)
      : normalizedCustomerId;

    const client = this.getGoogleAdsApiClient();
    const customer = createGoogleAdsCustomer(client, {
      customerId: normalizedCustomerId,
      refreshToken,
      loginCustomerId: normalizedLoginCustomerId,
    });

    try {
      const rows = await this.withSdkTimeout(
        customer.query(query) as Promise<T[]>,
        'googleAds:search',
      );
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      throw new BadRequestException(
        formatGoogleAdsSdkError(
          err,
          'Google Ads API request failed. Reconnect Google Ads in Settings → Integrations.',
        ),
      );
    }
  }

  private async withSdkTimeout<T>(
    promise: Promise<T>,
    context: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `Google Ads SDK request timed out (${context}). Please try again.`,
              ),
            );
          }, GOOGLE_ADS_SDK_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private getGoogleAdsApiClient() {
    return createGoogleAdsApiClient({
      clientId: this.tokenService.getClientId(),
      clientSecret: this.tokenService.getClientSecret(),
      developerToken: this.tokenService.getDeveloperToken(),
    });
  }

  private toNumber(value: string | number | null | undefined): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private normalizeEnumValue(
    value: string | number | null | undefined,
  ): string | null {
    if (value == null) {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const byCode: Record<number, string> = {
        0: 'UNSPECIFIED',
        1: 'UNKNOWN',
        2: 'ENABLED',
        3: 'PAUSED',
        4: 'REMOVED',
      };
      return byCode[value] ?? String(value);
    }

    const text = String(value).trim();
    if (!text) return null;

    const numeric = Number.parseInt(text, 10);
    if (String(numeric) === text) {
      const byCode: Record<number, string> = {
        0: 'UNSPECIFIED',
        1: 'UNKNOWN',
        2: 'ENABLED',
        3: 'PAUSED',
        4: 'REMOVED',
      };
      return byCode[numeric] ?? text;
    }

    return text.toUpperCase();
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
  ): Promise<{
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
  }> {
    try {
      const tokens = await exchangeGoogleAuthCode({ code, redirectUri });
      this.logger.log(
        `Google token exchange (googleapis SDK) hasAccessToken=${Boolean(tokens.access_token)} hasRefreshToken=${Boolean(tokens.refresh_token)} expiryDate=${tokens.expiry_date ?? 'n/a'} scope=${tokens.scope ?? '(empty)'}`,
      );
      return tokens;
    } catch (err) {
      this.logger.error(
        `Google token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'Google did not return an access token. Try connecting again.',
      );
    }
  }

  private async fetchGoogleUser(
    accessToken: string,
  ): Promise<{ id: string | null; email: string | null }> {
    try {
      return await fetchGoogleOAuthUserInfo(accessToken);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'Could not read your Google profile.',
      );
    }
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
      where: businessAccessWhere(user, businessId),
    });

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return business;
  }
}
