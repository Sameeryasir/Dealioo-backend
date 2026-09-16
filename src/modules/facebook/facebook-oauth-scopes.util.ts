import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';

export type MetaOauthPermissionStatus = 'granted' | 'missing';

export type MetaOauthPermissionMap = {
  ads_read: MetaOauthPermissionStatus;
  ads_management: MetaOauthPermissionStatus;
  pages_show_list: MetaOauthPermissionStatus;
  pages_read_engagement: MetaOauthPermissionStatus;
};

export type MetaOauthCapabilityMap = {
  campaignManagement: boolean;
  pageSelection: boolean;
  pageInformation: boolean;
  advertisingAnalytics: boolean;
};

export function parseFacebookScopeList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
}

export function getConfiguredFacebookOAuthScopes(): string[] {
  const scopes = parseFacebookScopeList(process.env.FACEBOOK_OAUTH_SCOPES);

  if (scopes.length === 0) {
    throw new InternalServerErrorException(
      'Set FACEBOOK_OAUTH_SCOPES in the environment (comma-separated Meta Login permissions).',
    );
  }

  return scopes;
}

export function getConfiguredFacebookRequiredScopes(): string[] {
  const required = parseFacebookScopeList(process.env.FACEBOOK_REQUIRED_SCOPES);
  if (required.length > 0) {
    return required;
  }

  return getConfiguredFacebookOAuthScopes();
}

export function toFacebookOAuthScopeParam(scopes: string[]): string {
  return scopes.join(',');
}

export function businessHasMetaOauthScope(
  metaOauthScopes: string | null | undefined,
  scope: string,
): boolean {
  return parseFacebookScopeList(metaOauthScopes ?? undefined).includes(scope);
}

export function buildMetaOauthPermissionMap(
  metaOauthScopes: string | null | undefined,
): MetaOauthPermissionMap {
  const status = (
    scope: keyof MetaOauthPermissionMap,
  ): MetaOauthPermissionStatus =>
    businessHasMetaOauthScope(metaOauthScopes, scope) ? 'granted' : 'missing';

  return {
    ads_read: status('ads_read'),
    ads_management: status('ads_management'),
    pages_show_list: status('pages_show_list'),
    pages_read_engagement: status('pages_read_engagement'),
  };
}

export function buildMetaOauthCapabilityMap(
  metaOauthScopes: string | null | undefined,
): MetaOauthCapabilityMap {
  const permissions = buildMetaOauthPermissionMap(metaOauthScopes);
  return {
    campaignManagement: permissions.ads_management === 'granted',
    pageSelection: permissions.pages_show_list === 'granted',
    pageInformation: permissions.pages_read_engagement === 'granted',
    advertisingAnalytics:
      permissions.ads_read === 'granted' ||
      permissions.ads_management === 'granted',
  };
}

export function assertBusinessHasMetaOauthScope(
  metaOauthScopes: string | null | undefined,
  scope: string,
  message?: string,
): void {
  if (!businessHasMetaOauthScope(metaOauthScopes, scope)) {
    throw new ForbiddenException(
      message ??
        `Meta ${scope} permission is required. Reconnect Meta Ads and grant ${scope}.`,
    );
  }
}

export function assertBusinessHasPagesReadEngagement(
  metaOauthScopes: string | null | undefined,
): void {
  if (!businessHasMetaOauthScope(metaOauthScopes, 'pages_read_engagement')) {
    throw new ForbiddenException({
      code: 'META_PAGES_READ_ENGAGEMENT_NOT_GRANTED',
      message:
        'Meta pages_read_engagement permission is required to load Facebook Page details. Reconnect Meta Ads and grant pages_read_engagement.',
    });
  }
}

export function assertBusinessCanManageMetaAds(
  metaOauthScopes: string | null | undefined,
): void {
  assertBusinessHasMetaOauthScope(
    metaOauthScopes,
    'ads_management',
    'Meta ads_management permission is required to create or manage campaigns. Reconnect Meta Ads and grant ads_management.',
  );
}

export function assertBusinessCanReadMetaAds(
  metaOauthScopes: string | null | undefined,
): void {
  if (
    businessHasMetaOauthScope(metaOauthScopes, 'ads_read') ||
    businessHasMetaOauthScope(metaOauthScopes, 'ads_management')
  ) {
    return;
  }

  throw new ForbiddenException(
    'Meta ads_read permission is required to view advertising analytics. Reconnect Meta Ads and grant ads_read.',
  );
}
