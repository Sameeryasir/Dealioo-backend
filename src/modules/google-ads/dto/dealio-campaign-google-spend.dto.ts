export class DealioCampaignGoogleSpendDto {
  period: string;
  spend: number;
  currency: string | null;
  linkedGoogleCampaignCount: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;

  constructor(input: {
    period: string;
    spend: number;
    currency: string | null;
    linkedGoogleCampaignCount: number;
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number | null;
  }) {
    this.period = input.period;
    this.spend = input.spend;
    this.currency = input.currency;
    this.linkedGoogleCampaignCount = input.linkedGoogleCampaignCount;
    this.impressions = input.impressions;
    this.reach = input.reach;
    this.clicks = input.clicks;
    this.ctr = input.ctr;
  }
}
