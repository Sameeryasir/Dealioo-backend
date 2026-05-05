import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FunnelPublicationStatus } from '../../../db/entities/funnel.entity';

export class CreateFunnelDto {
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  restaurantId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  campaignName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  websiteUrl: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  offer?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  price?: number;

  @IsOptional()
  @IsEnum(FunnelPublicationStatus)
  status?: FunnelPublicationStatus;
}
