import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class CreateAutomationExecutionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  automationId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  customerId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentNodeId: number;
}
