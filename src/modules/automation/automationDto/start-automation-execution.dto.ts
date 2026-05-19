import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, Min } from 'class-validator';

export class StartAutomationExecutionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  automationId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  customerId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentNodeId?: number;
}
