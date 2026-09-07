import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export enum RedemptionChannel {
  QR_SCAN = 'qr_scan',
  STAFF_LOOKUP = 'staff_lookup',
}

export class ExtraItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  unitPrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty!: number;
}

export class ScanQrDto {
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  qrToken: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  couponIds?: number[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  orderSubtotal?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  extraItemsAmount?: number;

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
  @Type(() => ExtraItemDto)
  extraItems?: ExtraItemDto[];

  @IsOptional()
  @IsEnum(RedemptionChannel)
  channel?: RedemptionChannel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceInfo?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}
