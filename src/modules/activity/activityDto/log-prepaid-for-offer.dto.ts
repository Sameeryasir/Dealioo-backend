import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class ExtraItemMetaDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitPriceCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number;
}

export class LogPrepaidForOfferDto {
  @IsInt()
  @Min(1)
  paymentId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  extraItemsCents?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  extraItemNames?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExtraItemMetaDto)
  extraItems?: ExtraItemMetaDto[];

  @IsOptional()
  @IsBoolean()
  counterExtrasOnly?: boolean;
}
