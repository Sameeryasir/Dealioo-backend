export class GooglePublishStatusDto {
  draftId: string;
  status: string;
  publishStatus: string | null;
  publishStep: string | null;
  publishProgress: number;
  jobId: string | null;
  googleBudgetId: string | null;
  googleCampaignId: string | null;
  googleAdGroupId: string | null;
  googleAdId: string | null;
  googleKeywordIds: string[];
  errorMessage: string | null;
  publishedAt: Date | null;
  adsConsoleUrl: string | null;
  version: number;
}
