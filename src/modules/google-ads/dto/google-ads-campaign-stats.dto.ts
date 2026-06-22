export class GoogleAdsCampaignInsightDto {
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  conversions: string | null;
}

export class GoogleAdsCampaignDto {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: string | null;
  insights: GoogleAdsCampaignInsightDto | null;
}

export class GoogleAdsCampaignStatsDto {
  customerId: string | null;
  customerName: string | null;
  currency: string | null;
  datePreset: string;
  campaigns: GoogleAdsCampaignDto[];
}
