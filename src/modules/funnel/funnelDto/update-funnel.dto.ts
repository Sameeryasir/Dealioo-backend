import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';

export class UpdateFunnelDto {
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  @Min(1)
  expectedVersion: number;

  @IsOptional()
  @IsObject()
  pages?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
