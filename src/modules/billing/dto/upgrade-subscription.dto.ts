import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UpgradeSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^price_/, {
    message: 'priceId must be a valid Stripe Price id (price_...).',
  })
  priceId: string;
}
