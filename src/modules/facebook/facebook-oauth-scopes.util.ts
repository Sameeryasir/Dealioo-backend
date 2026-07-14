import { InternalServerErrorException } from '@nestjs/common';

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
