export type DiagnosticStepStatus = 'success' | 'failed' | 'skipped' | 'warning';

export class PublishDiagnosticStepDto {
  name: string;
  label: string;
  status: DiagnosticStepStatus;
  message?: string;
  metaErrorCode?: number | null;
  metaErrorMessage?: string;
  details?: Record<string, unknown>;
}

export class PublishMetaCampaignDiagnosticDto {
  generatedAt: string;
  draftId: string;
  restaurantId: number;
  overallSuccess: boolean;
  firstFailingStep?: string;
  recommendedFix?: string;
  steps: PublishDiagnosticStepDto[];
  connection: {
    metaUserId: string | null;
    adAccountId: string | null;
    facebookPageId: string | null;
    tokenExpiresAt: string | null;
    tokenValid: boolean;
    connectedAt: string | null;
    storedScopes: string | null;
  };
  permissions: Record<string, string>;
  adAccounts: Array<{ id: string; name?: string; accountStatus?: number }>;
  selectedAdAccountFound: boolean;
  storedMetaIds: {
    metaCampaignId: string | null;
    metaAdsetId: string | null;
    metaCreativeId: string | null;
    metaAdId: string | null;
    draftStatus: string | null;
  };
  draftSummary: {
    campaignName: string;
    adSetName: string;
    creativeName: string;
    creativeFormat: string;
    hasImage: boolean;
    hasVideo: boolean;
  };
  publishEndpoint: {
    method: string;
    path: string;
  };
}
