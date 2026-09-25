import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateGoogleAdsCampaignStatusDto {
  @IsIn(['ENABLED', 'PAUSED'])
  status: 'ENABLED' | 'PAUSED';
}

export class UpdateGoogleAdsCampaignBudgetDto {
  @IsNumber()
  @Min(1)
  dailyBudget: number;
}

export class UpdateGoogleAdsCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['ENABLED', 'PAUSED'])
  status?: 'ENABLED' | 'PAUSED';

  @IsOptional()
  @IsNumber()
  @Min(1)
  dailyBudget?: number;
}
