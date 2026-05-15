import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString, Min } from 'class-validator';

/** Checkout charge amount comes from the funnel’s campaign `price`, not the body. */
export class CreatePaymentIntentDto {
  @Type(() => Number)
  @IsInt()
  funnelId: number;

  @Type(() => Number)
  @IsInt()
  restaurantId: number;

  /** Platform fee in Stripe’s smallest unit for `currency` (e.g. cents for USD). Must be strictly less than the campaign-derived charge amount. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  applicationFeeAmount: number;

  @IsString()
  currency: string;

  @IsEmail()
  customerEmail: string;
}
