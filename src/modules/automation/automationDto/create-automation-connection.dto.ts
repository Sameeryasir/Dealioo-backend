import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

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
}
