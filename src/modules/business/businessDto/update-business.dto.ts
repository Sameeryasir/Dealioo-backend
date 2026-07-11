import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  cuisineType?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email?: string;

  /** Any contact number format (matches create-business validation). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  branchCount?: number;
}
