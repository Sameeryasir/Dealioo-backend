import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';
import { AutomationNodeType } from '../../../db/entities/automation-node.entity';

export class CreateAutomationNodeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  automationId: number;

  @IsEnum(AutomationNodeType)
  type: AutomationNodeType;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  positionX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  positionY?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsNotEmpty()
  order: number;
}
