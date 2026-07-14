export class FacebookConnectionStatusDto {
  connected: boolean;
  status: string | null;
  metaUserId: string | null;
  metaConnectedAt: Date | null;
  metaAdAccountId: string | null;
  metaTokenExpiresAt: Date | null;
  metaOauthScopes: string[];
  missingRequiredScopes: string[];
  requestedScopes: string[];
  requiredScopes: string[];
}
