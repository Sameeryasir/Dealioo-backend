import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsObject, IsOptional, Min } from 'class-validator';

export class CreateFunnelDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  campaignId: number;

  @IsOptional()
  @IsObject()
  pages?: Record<string, unknown>;
}
