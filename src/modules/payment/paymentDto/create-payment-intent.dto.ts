import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString } from 'class-validator';

export class CreatePaymentIntentDto {
  @Type(() => Number)
  @IsInt()
  funnelId: number;

  @Type(() => Number)
  @IsInt()
  businessId: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsEmail()
  customerEmail: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @IsString()
  checkoutSessionToken?: string;
}
