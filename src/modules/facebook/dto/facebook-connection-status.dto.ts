export class FacebookConnectionStatusDto {
  connected: boolean;
  status: string | null;
  metaUserId: string | null;
  metaConnectedAt: Date | null;
  metaAdAccountId: string | null;
  metaTokenExpiresAt: Date | null;
  /** Scopes Meta granted at last connect (from debug_token). */
  metaOauthScopes: string[];
  /** Required scopes still missing from the stored grant. */
  missingRequiredScopes: string[];
}
