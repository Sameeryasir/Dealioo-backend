import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class ClearLandingImageDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  businessId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  campaignId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  funnelId?: number;
}
