import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString } from 'class-validator';

/**
 * Checkout charge amount and platform fee are computed server-side only.
 * Never accept fee or price from the client (security).
 */
export class CreatePaymentIntentDto {
  @Type(() => Number)
  @IsInt()
  funnelId: number;

  @Type(() => Number)
  @IsInt()
  restaurantId: number;

  @IsString()
  currency: string;

  @IsEmail()
  customerEmail: string;
}
