import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class TrackGoogleFunnelEventDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  eventId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  eventName!: string;

  @IsInt()
  @Min(1)
  businessId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  funnelId?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  googleAdsId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  conversionLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  sendTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  eventTime?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  eventSourceUrl?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  transactionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  gclid?: string;

  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientIp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  userAgent?: string;
}
