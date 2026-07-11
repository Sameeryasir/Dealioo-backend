import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const BUSINESS_FUNNEL_EVENT_STATUS_FILTERS = [
  'all',
  'paid',
  'not_paid',
] as const;

export const BUSINESS_FUNNEL_EVENT_DATE_FILTERS = [
  'all',
  'today',
  'week',
  'month',
] as const;

export type BusinessFunnelEventStatusFilter =
  (typeof BUSINESS_FUNNEL_EVENT_STATUS_FILTERS)[number];

export type BusinessFunnelEventDateFilter =
  (typeof BUSINESS_FUNNEL_EVENT_DATE_FILTERS)[number];

export class GetBusinessFunnelEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(BUSINESS_FUNNEL_EVENT_STATUS_FILTERS)
  status?: BusinessFunnelEventStatusFilter;

  @IsOptional()
  @IsIn(BUSINESS_FUNNEL_EVENT_DATE_FILTERS)
  date?: BusinessFunnelEventDateFilter;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
