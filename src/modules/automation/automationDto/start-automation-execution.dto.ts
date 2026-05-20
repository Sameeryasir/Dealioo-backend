import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class StartAutomationExecutionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  automationId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentNodeId?: number;
}
