export class FacebookAdCampaignActionDto {
  actionType: string;
  value: string;
}

export class FacebookAdCampaignInsightDto {
  spend: string | null;
  impressions: string | null;
  reach: string | null;
  clicks: string | null;
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  frequency: string | null;
  actions: FacebookAdCampaignActionDto[] | null;
  costPerActionType: FacebookAdCampaignActionDto[] | null;
}

export class FacebookAdDailyInsightDto {
  date: string;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
}

export class FacebookAdCampaignDto {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: string | null;
  imageUrl: string | null;
  insights: FacebookAdCampaignInsightDto | null;
  dailyInsights: FacebookAdDailyInsightDto[] | null;
}

export class FacebookAdBreakdownRowDto {
  key: string;
  impressions: string | null;
  spend: string | null;
}

export class FacebookAdInsightBreakdownsDto {
  age: FacebookAdBreakdownRowDto[];
  device: FacebookAdBreakdownRowDto[];
  placement: FacebookAdBreakdownRowDto[];
  country: FacebookAdBreakdownRowDto[];
}

export class FacebookAdCampaignStatsSummaryDto {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  activeCampaigns: number;
  totalCampaigns: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  primaryActionType: string | null;
  primaryActionValue: string | null;
  costPerResult: number | null;
}

export class FacebookAdCampaignPaginationDto {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  query: string | null;
}

export class FacebookAdCampaignStatsDto {
  adAccountId: string | null;
  adAccountName: string | null;
  currency: string | null;
  datePreset: string;
  campaigns: FacebookAdCampaignDto[];
  dailyInsights: FacebookAdDailyInsightDto[];
  breakdowns: FacebookAdInsightBreakdownsDto | null;
  fetchedAt: string | null;
  fromCache: boolean;
  isStale: boolean;
  summary: FacebookAdCampaignStatsSummaryDto | null;
  pagination: FacebookAdCampaignPaginationDto | null;
}
