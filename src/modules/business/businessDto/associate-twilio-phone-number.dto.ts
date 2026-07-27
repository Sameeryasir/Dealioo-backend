import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AssociateTwilioPhoneNumberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  phoneSid!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phoneNumber!: string;
}
