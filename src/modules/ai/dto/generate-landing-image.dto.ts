import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateLandingImageDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  prompt!: string;

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
