import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
