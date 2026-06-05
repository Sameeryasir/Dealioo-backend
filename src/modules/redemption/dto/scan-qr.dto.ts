import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class ScanQrDto {
  @IsString()
  @MinLength(8)
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
  deviceInfo?: string;
}
