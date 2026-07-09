import { AdCreativeStepDataDto } from './ad-creative-step-data.dto';
import { AdSetStepDataDto } from './adset-step-data.dto';

export type CampaignStepDataDto = {
  name: string;
  buyingType: string;
  objective: string;
  specialAdCategories: string[];
  campaignBudgetOptimization: boolean;
  budgetStrategy: string;
  campaignBudgetType?: string;
  campaignDailyBudget?: number;
  campaignLifetimeBudget?: number;
  campaignBidStrategy?: string;
  budgetScheduling?: string;
  campaignSpendLimit?: number;
  status: string;
};

export class MetaCampaignDraftResponseDto {
  id: string;
  businessId: number;
  currentStep: number;
  status: string;
  campaignData: CampaignStepDataDto | null;
  adSetData: AdSetStepDataDto | null;
  adCreativeData: AdCreativeStepDataDto | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaCreativeId: string | null;
  metaAdId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
