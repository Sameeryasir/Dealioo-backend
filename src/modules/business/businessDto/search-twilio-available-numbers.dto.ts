import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function toOptionalBoolean({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }
  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }
  return undefined;
}

export class SearchTwilioAvailableNumbersDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  areaCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  areaName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  contains?: string;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  voice?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  mms?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  fax?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
