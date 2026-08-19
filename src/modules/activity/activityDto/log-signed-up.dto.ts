import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class LogSignedUpDto {
  @IsInt()
  @Min(1)
  businessId: number;

  @IsInt()
  @Min(1)
  customerId: number;

  @IsInt()
  @Min(1)
  funnelId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  campaignId?: number | null;

  @IsOptional()
  @IsString()
  campaignName?: string | null;

  @IsOptional()
  @IsString()
  campaignType?: string | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;
}
