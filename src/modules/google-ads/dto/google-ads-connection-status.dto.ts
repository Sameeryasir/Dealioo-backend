export class GoogleAdsConnectionStatusDto {
  connected: boolean;
  status: string | null;
  googleUserId: string | null;
  googleConnectedAt: Date | null;
  googleCustomerId: string | null;
  googleTokenExpiresAt: Date | null;
  googleOauthScopes: string[];
  missingRequiredScopes: string[];
}
