import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BusinessDraftPayloadDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

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
  @MaxLength(32)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  branchCount?: number;
}

export class UpsertBusinessDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  step?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BusinessDraftPayloadDto)
  payload?: BusinessDraftPayloadDto;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string | null;
}
