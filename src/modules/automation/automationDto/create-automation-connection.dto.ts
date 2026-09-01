import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateAutomationConnectionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  automationId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceNodeId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetNodeId: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  branch?: string;
}
