export class DealioCampaignMetaSpendDto {
  period: string;
  spend: number;
  currency: string | null;
  linkedMetaCampaignCount: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;

  constructor(input: {
    period: string;
    spend: number;
    currency: string | null;
    linkedMetaCampaignCount: number;
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number | null;
  }) {
    this.period = input.period;
    this.spend = input.spend;
    this.currency = input.currency;
    this.linkedMetaCampaignCount = input.linkedMetaCampaignCount;
    this.impressions = input.impressions;
    this.reach = input.reach;
    this.clicks = input.clicks;
    this.ctr = input.ctr;
  }
}
