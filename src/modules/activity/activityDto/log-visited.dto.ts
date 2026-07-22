import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type { EntityManager } from 'typeorm';
import { CustomerVisitSource } from '../../../db/entities/customer-visit.entity';

export class LogVisitedDto {
  @IsInt()
  @Min(1)
  businessId: number;

  @IsInt()
  @Min(1)
  customerId: number;

  @IsInt()
  @Min(1)
  couponId: number;

  @IsString()
  @MinLength(1)
  businessName: string;

  @Type(() => Date)
  @IsDate()
  occurredAt: Date;

  @IsOptional()
  @IsEnum(CustomerVisitSource)
  visitSource?: CustomerVisitSource;

  @IsOptional()
  manager?: EntityManager;
}
