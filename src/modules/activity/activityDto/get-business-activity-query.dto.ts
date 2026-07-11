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
import {
  ACTIVITY_EVENT_TYPE_FILTERS,
  type ActivityEventTypeFilter,
} from '../activity-filters.util';

export class GetBusinessActivityQueryDto {
  @IsOptional()
  @IsIn(ACTIVITY_EVENT_TYPE_FILTERS)
  eventType?: ActivityEventTypeFilter;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class GetBusinessActivityEventsQueryDto extends GetBusinessActivityQueryDto {
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
}
