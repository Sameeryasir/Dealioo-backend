import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type { EntityManager } from 'typeorm';

export class LogMessageSentDto {
  @IsInt()
  @Min(1)
  restaurantId: number;

  @IsInt()
  @Min(1)
  customerId: number;

  @IsString()
  @MinLength(1)
  messagePreview: string;

  @IsString()
  @MinLength(1)
  idempotencyKey: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  occurredAt?: Date;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  manager?: EntityManager;
}
