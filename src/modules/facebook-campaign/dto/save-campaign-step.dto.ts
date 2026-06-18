import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MetaAdSetBudgetType,
  MetaBidStrategy,
  MetaBuyingType,
  MetaCampaignObjective,
  MetaCampaignStatus,
  MetaSpecialAdCategory,
} from '../meta-campaign.constants';

export enum MetaBudgetStrategy {
  CAMPAIGN = 'campaign',
  ADSET = 'adset',
}

export class SaveCampaignStepDto {
  @IsOptional()
  @IsUUID()
  draftId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(MetaBuyingType)
  buyingType: MetaBuyingType;

  @IsEnum(MetaCampaignObjective)
  objective: MetaCampaignObjective;

  @IsArray()
  @IsEnum(MetaSpecialAdCategory, { each: true })
  specialAdCategories: MetaSpecialAdCategory[];

  @IsEnum(MetaBudgetStrategy)
  budgetStrategy: MetaBudgetStrategy;

  @ValidateIf((dto: SaveCampaignStepDto) => dto.budgetStrategy === MetaBudgetStrategy.CAMPAIGN)
  @IsEnum(MetaAdSetBudgetType)
  campaignBudgetType?: MetaAdSetBudgetType;

  @ValidateIf(
    (dto: SaveCampaignStepDto) =>
      dto.budgetStrategy === MetaBudgetStrategy.CAMPAIGN &&
      dto.campaignBudgetType === MetaAdSetBudgetType.DAILY,
  )
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  campaignDailyBudget?: number;

  @ValidateIf(
    (dto: SaveCampaignStepDto) =>
      dto.budgetStrategy === MetaBudgetStrategy.CAMPAIGN &&
      dto.campaignBudgetType === MetaAdSetBudgetType.LIFETIME,
  )
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  campaignLifetimeBudget?: number;

  @ValidateIf((dto: SaveCampaignStepDto) => dto.budgetStrategy === MetaBudgetStrategy.CAMPAIGN)
  @IsEnum(MetaBidStrategy)
  campaignBidStrategy?: MetaBidStrategy;

  @IsOptional()
  @IsString()
  budgetScheduling?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  campaignSpendLimit?: number;

  @IsEnum(MetaCampaignStatus)
  status: MetaCampaignStatus;

  /** @deprecated use budgetStrategy — kept for backward compat in stored drafts */
  @IsOptional()
  @IsBoolean()
  campaignBudgetOptimization?: boolean;
}
