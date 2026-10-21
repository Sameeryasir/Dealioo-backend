import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Apply inbound SMS webhook to a platform-owned Twilio number.
 * Use phoneNumber so the Super Admin UI never needs phone SIDs.
 * smsUrl is further validated server-side (https + no private hosts).
 */
export class SetAdminTwilioWebhookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\+?[0-9]{8,15}$/, {
    message: 'phoneNumber must be a valid E.164-style number.',
  })
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  smsUrl?: string;
}
