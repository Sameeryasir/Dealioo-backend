import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class UpgradeSubscriptionDto {
  @IsOptional()
  @IsString()
  @Matches(/^price_/, {
    message: 'priceId must be a valid Stripe Price id (price_...).',
  })
  priceId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  planSlug?: string;

  @IsOptional()
  @IsIn(['monthly', 'annual'])
  billingCycle?: 'monthly' | 'annual';
}
