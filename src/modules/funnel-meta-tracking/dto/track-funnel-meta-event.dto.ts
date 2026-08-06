import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class TrackFunnelMetaEventDto {
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
  pixelId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  eventTime?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  eventSourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  actionSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbclid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

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
