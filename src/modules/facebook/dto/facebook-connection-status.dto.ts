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
  permissions: {
    ads_read: 'granted' | 'missing';
    ads_management: 'granted' | 'missing';
    pages_show_list: 'granted' | 'missing';
    pages_read_engagement: 'granted' | 'missing';
  };
  capabilities: {
    campaignManagement: boolean;
    pageSelection: boolean;
    pageInformation: boolean;
    advertisingAnalytics: boolean;
  };
}
