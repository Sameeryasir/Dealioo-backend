import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class CreateCheckoutSessionDto {
  @Type(() => Number)
  @IsInt()
  customerId: number;

  @Type(() => Number)
  @IsInt()
  funnelId: number;

  @Type(() => Number)
  @IsInt()
  restaurantId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  campaignId?: number;
}
