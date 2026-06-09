import {
  IsDate,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ActivityEventType } from '../../../db/entities/activity-event.entity';

export class CreateActivityEventDto {
  @IsInt()
  @Min(1)
  restaurantId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  customerId: number | null;

  @IsEnum(ActivityEventType)
  eventType: ActivityEventType;

  @IsString()
  @MinLength(1)
  description: string;

  @IsString()
  @MinLength(1)
  idempotencyKey: string;

  @IsOptional()
  @IsDate()
  occurredAt?: Date;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}
