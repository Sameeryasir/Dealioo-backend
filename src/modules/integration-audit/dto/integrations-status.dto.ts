export type PublicStripeIntegrationStatus = {
  connected: boolean;
  status: string | null;
  stripeAccountId: string | null;
  stripeAccountName: string | null;
};

export type PublicFacebookIntegrationStatus = {
  connected: boolean;
  status: string | null;
  metaOauthScopes: string[];
  missingRequiredScopes: string[];
  metaAdAccountId: string | null;
  metaAdAccountName: string | null;
};

export type PublicGoogleAdsIntegrationStatus = {
  connected: boolean;
  status: string | null;
  googleOauthScopes: string[];
  missingRequiredScopes: string[];
  googleCustomerId: string | null;
  googleCustomerName: string | null;
};

export type IntegrationsStatusDto = {
  stripe: PublicStripeIntegrationStatus;
  facebook: PublicFacebookIntegrationStatus;
  googleAds: PublicGoogleAdsIntegrationStatus;
};
