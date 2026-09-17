import { IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export class ConnectTwilioCredentialsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^AC[0-9a-fA-F]{32}$/, {
    message: 'Account SID must look like a Twilio Account SID (starts with AC).',
  })
  accountSid!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  authToken!: string;
}
