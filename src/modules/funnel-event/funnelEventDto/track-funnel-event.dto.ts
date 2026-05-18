import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { FunnelEventType } from '../../../db/entities/funnel-event.entity';
import { FunnelPaymentStatus } from '../../../db/entities/funnel-payment.entity';

export class TrackFunnelEventDto {
  @IsEnum(FunnelEventType)
  eventType: FunnelEventType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  funnelId: number;

  @IsOptional()
  @IsString()
  visitorId?: string;

  @ValidateIf(
    (dto: TrackFunnelEventDto) =>
      dto.eventType === FunnelEventType.SIGNUP ||
      dto.eventType === FunnelEventType.PAYMENT,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId?: number;

  @ValidateIf((dto: TrackFunnelEventDto) => dto.eventType === FunnelEventType.PAYMENT)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  funnelPaymentId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(FunnelPaymentStatus)
  paymentStatus?: FunnelPaymentStatus;

  @IsOptional()
  @IsString()
  stripePaymentIntentId?: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;
}
