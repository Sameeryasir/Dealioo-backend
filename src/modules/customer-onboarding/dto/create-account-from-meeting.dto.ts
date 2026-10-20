import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const EXISTING_USER_ACTIONS = [
  'link_and_create_business',
  'link_existing_business',
] as const;

export class CreateAccountFromMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  businessType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  businessEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsIn(EXISTING_USER_ACTIONS)
  existingUserAction?: (typeof EXISTING_USER_ACTIONS)[number];

  @ValidateIf((dto: CreateAccountFromMeetingDto) =>
    dto.existingUserAction === 'link_existing_business',
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  linkBusinessId?: number;
}
