import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString } from 'class-validator';

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

  /** Links the signup QR pass to this checkout session. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  /** Updates the server checkout session with the created payment row. */
  @IsOptional()
  @IsString()
  checkoutSessionToken?: string;
}
