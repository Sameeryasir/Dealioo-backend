import type { CampaignType } from '../../../db/entities/campaign.entity';

export type BusinessFunnelSummary = {
  id: number;
  campaignName: string;
  price: number | null;
  imageUrl: string | null;
  campaignType: CampaignType | null;
};
