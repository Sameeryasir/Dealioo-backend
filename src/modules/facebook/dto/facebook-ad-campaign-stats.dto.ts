export class FacebookAdCampaignInsightDto {
  spend: string | null;
  impressions: string | null;
  reach: string | null;
  clicks: string | null;
}

export class FacebookAdCampaignDto {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: string | null;
  insights: FacebookAdCampaignInsightDto | null;
}

export class FacebookAdCampaignStatsDto {
  adAccountId: string | null;
  adAccountName: string | null;
  currency: string | null;
  datePreset: string;
  campaigns: FacebookAdCampaignDto[];
}
