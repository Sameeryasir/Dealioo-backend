import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BusinessHistoryEventType } from '../../../db/entities/business-history.entity';

export const HISTORY_CATEGORIES = [
  'all',
  'funnels',
  'automations',
  'campaigns',
  'payments',
] as const;

export type HistoryCategory = (typeof HISTORY_CATEGORIES)[number];

export const HISTORY_EVENT_TYPES = Object.values(BusinessHistoryEventType);

export class GetBusinessHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsIn(HISTORY_CATEGORIES)
  category?: HistoryCategory;

  @IsOptional()
  @IsIn(HISTORY_EVENT_TYPES)
  eventType?: BusinessHistoryEventType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  actorUserId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
