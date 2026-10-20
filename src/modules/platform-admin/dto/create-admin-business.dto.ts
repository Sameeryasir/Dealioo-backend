import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateAdminBusinessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  ownerEmail: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  businessType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'websiteUrl must be a valid https URL' },
  )
  @MaxLength(2048)
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
}
