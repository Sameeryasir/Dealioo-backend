import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  businessType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency: string;

  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'websiteUrl must be a valid https URL' },
  )
  @MaxLength(2048)
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  branchCount?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  twilioPhoneSid: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  twilioPhoneNumber: string;
}
