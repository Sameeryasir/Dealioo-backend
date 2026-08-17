export type PublicStripeIntegrationStatus = {
  connected: boolean;
  status: string | null;
};

export type PublicFacebookIntegrationStatus = {
  connected: boolean;
  status: string | null;
  metaOauthScopes: string[];
  missingRequiredScopes: string[];
};

export type PublicGoogleAdsIntegrationStatus = {
  connected: boolean;
  status: string | null;
  googleOauthScopes: string[];
  missingRequiredScopes: string[];
};

export type IntegrationsStatusDto = {
  stripe: PublicStripeIntegrationStatus;
  facebook: PublicFacebookIntegrationStatus;
  googleAds: PublicGoogleAdsIntegrationStatus;
};
