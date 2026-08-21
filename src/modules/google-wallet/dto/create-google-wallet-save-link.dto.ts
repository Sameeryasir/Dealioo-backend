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

  /** Guest pass page URL (tappable link on the Wallet card). */
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  qrOrRedemptionUrl: string;

  /** Same token the Dealioo scanner QR uses. */
  @IsString()
  @IsNotEmpty()
  qrToken: string;
}
