import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class CreateGoogleWalletSaveLinkDto {
  @IsString()
  @IsNotEmpty()
  passId: string;

  @IsString()
  @IsNotEmpty()
  offerName: string;

  @IsString()
  @IsNotEmpty()
  businessName: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  qrOrRedemptionUrl: string;

  @IsString()
  @IsNotEmpty()
  qrToken: string;
}
