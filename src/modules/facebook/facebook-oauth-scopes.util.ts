import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';

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

/** Create/edit/delete Meta campaigns require ads_management (ads_read alone is not enough). */
export function assertBusinessCanManageMetaAds(
  metaOauthScopes: string | null | undefined,
): void {
  if (!businessHasMetaOauthScope(metaOauthScopes, 'ads_management')) {
    throw new ForbiddenException(
      'Meta ads_management permission is required to create or manage campaigns. Reconnect Meta Ads and grant Manage advertising campaigns.',
    );
  }
}
