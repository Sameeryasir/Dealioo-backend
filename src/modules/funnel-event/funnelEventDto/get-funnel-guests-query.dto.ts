import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GetFunnelGuestsQueryDto {
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

  // ISO range edges from the overview calendar (toISOString can exceed 40 chars with offsets)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  // Required by Overview Meta/Google counts — ValidationPipe forbidNonWhitelisted rejects unknown query keys
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
