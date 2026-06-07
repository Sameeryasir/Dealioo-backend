import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
  @IsString()
  @MaxLength(500)
  deviceInfo?: string;

  /** Client-generated key to safely retry redemption after network failures. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}
