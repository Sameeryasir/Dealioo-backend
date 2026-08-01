import { SELECTABLE_META_OAUTH_SCOPES } from './dto/connect-facebook.dto';

export const META_IDENTITY_SCOPE = 'public_profile';

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
  return [...new Set([META_IDENTITY_SCOPE, ...selectable])];
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
  return normalizeSelectableMetaScopes(requestedSelectable).filter(
    (scope) => !grantedSet.has(scope),
  );
}
