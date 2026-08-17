import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ConfirmPaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^seti_/, {
    message: 'setupIntentId must be a valid Stripe SetupIntent id.',
  })
  setupIntentId!: string;
}
