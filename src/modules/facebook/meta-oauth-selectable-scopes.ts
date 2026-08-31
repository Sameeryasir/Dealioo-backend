import { SELECTABLE_META_OAUTH_SCOPES } from './dto/connect-facebook.dto';

export const META_IDENTITY_SCOPE = 'public_profile';

export const META_ADS_MANAGEMENT_PAGE_SCOPE = 'pages_read_engagement';

export const META_ADS_MANAGEMENT_PAGES_SHOW_LIST_SCOPE = 'pages_show_list';

export const META_ADS_MANAGEMENT_DEPENDENT_PAGE_SCOPES = [
  META_ADS_MANAGEMENT_PAGES_SHOW_LIST_SCOPE,
  META_ADS_MANAGEMENT_PAGE_SCOPE,
] as const;

export function normalizeSelectableMetaScopes(raw: string[]): string[] {
  const allowed = new Set<string>(SELECTABLE_META_OAUTH_SCOPES);
  return [
    ...new Set(
      raw
        .map((scope) => scope.trim())
        .filter((scope) => allowed.has(scope)),
    ),
  ];
}

export function assertRequestedMetaScopesSelected(selected: string[]): string[] {
  const normalized = normalizeSelectableMetaScopes(selected);
  if (normalized.length === 0) {
    throw new Error(
      'Select at least one Meta Ads permission before connecting.',
    );
  }
  return normalized;
}

export function buildMetaOAuthDialogScopes(selected: string[]): string[] {
  const selectable = assertRequestedMetaScopesSelected(selected);
  const scopes = new Set<string>([META_IDENTITY_SCOPE, ...selectable]);

  if (selectable.includes('ads_management')) {
    for (const scope of META_ADS_MANAGEMENT_DEPENDENT_PAGE_SCOPES) {
      scopes.add(scope);
    }
  }

  return [...scopes];
}

export function filterGrantedSelectableScopes(
  granted: string[],
  requestedSelectable: string[],
): string[] {
  const requested = new Set(normalizeSelectableMetaScopes(requestedSelectable));
  return [
    ...new Set(
      granted
        .map((scope) => scope.trim())
        .filter((scope) => requested.has(scope)),
    ),
  ];
}

export function findMissingRequestedScopes(
  granted: string[],
  requestedSelectable: string[],
): string[] {
  const grantedSet = new Set(
    granted.map((scope) => scope.trim()).filter(Boolean),
  );
  const softFail = new Set<string>(META_ADS_MANAGEMENT_DEPENDENT_PAGE_SCOPES);
  return normalizeSelectableMetaScopes(requestedSelectable).filter(
    (scope) => !softFail.has(scope) && !grantedSet.has(scope),
  );
}
