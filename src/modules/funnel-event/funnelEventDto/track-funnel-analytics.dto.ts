import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { FunnelAnalyticsEventType } from '../../../db/entities/funnel-analytics-event.entity';

export class TrackFunnelAnalyticsDto {
  @IsEnum(FunnelAnalyticsEventType)
  eventType: FunnelAnalyticsEventType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  funnelId: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  visitorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  pagePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stepName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stepOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  referrer?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
