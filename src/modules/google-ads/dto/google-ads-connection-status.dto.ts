export class GoogleAdsConnectionStatusDto {
  connected: boolean;
  status: string | null;
  googleUserId: string | null;
  googleConnectedAt: Date | null;
  googleTokenExpiresAt: Date | null;
  googleOauthScopes: string[];
  missingRequiredScopes: string[];
}
