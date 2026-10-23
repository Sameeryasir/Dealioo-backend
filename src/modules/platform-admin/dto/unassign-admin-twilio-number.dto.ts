import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Unassign a platform Twilio number from whatever business it is linked to.
 * Keeps the number on the Dealioo Twilio account — only clears the business link.
 */
export class UnassignAdminTwilioNumberDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phoneSid?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\+?[0-9]{8,15}$/, {
    message: 'phoneNumber must be a valid E.164-style number.',
  })
  phoneNumber!: string;
}
