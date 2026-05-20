import { Type } from 'class-transformer';
import { IsEnum, IsInt, Min } from 'class-validator';
import { AutomationPurpose } from '../../../db/entities/automation-purpose.enum';

export class CreateAutomationExecutionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  automationId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentNodeId: number;

  @IsEnum(AutomationPurpose)
  purpose: AutomationPurpose;
}
