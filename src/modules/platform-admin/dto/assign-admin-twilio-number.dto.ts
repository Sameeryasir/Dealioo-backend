import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Assign a platform-owned Twilio number to a business.
 * phoneNumber is required; phoneSid is optional (resolved server-side).
 */
export class AssignAdminTwilioNumberDto {
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

  @Type(() => Number)
  @IsInt()
  @Min(1)
  businessId!: number;
}
