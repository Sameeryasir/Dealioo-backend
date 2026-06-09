import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type { EntityManager } from 'typeorm';

export class LogVisitedDto {
  @IsInt()
  @Min(1)
  restaurantId: number;

  @IsInt()
  @Min(1)
  customerId: number;

  @IsInt()
  @Min(1)
  couponId: number;

  @IsString()
  @MinLength(1)
  restaurantName: string;

  @Type(() => Date)
  @IsDate()
  occurredAt: Date;

  @IsOptional()
  manager?: EntityManager;
}
