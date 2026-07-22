import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum RedemptionChannel {
  QR_SCAN = 'qr_scan',
  STAFF_LOOKUP = 'staff_lookup',
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
  @IsEnum(RedemptionChannel)
  channel?: RedemptionChannel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  registerId?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}
