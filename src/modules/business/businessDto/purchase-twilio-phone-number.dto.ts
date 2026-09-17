import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PurchaseTwilioPhoneNumberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phoneNumber!: string;
}
