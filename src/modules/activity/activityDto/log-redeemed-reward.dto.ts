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
import { Coupon } from '../../../db/entities/coupon.entity';

export class LogRedeemedRewardDto {
  @IsInt()
  @Min(1)
  businessId: number;

  @IsInt()
  @Min(1)
  customerId: number;

  coupon: Coupon;

  @IsString()
  @MinLength(1)
  businessName: string;

  @Type(() => Date)
  @IsDate()
  occurredAt: Date;

  @IsOptional()
  manager?: EntityManager;
}
