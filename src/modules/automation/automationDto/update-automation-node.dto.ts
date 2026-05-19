import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';
import { AutomationNodeType } from '../../../db/entities/automation-node.entity';

export class UpdateAutomationNodeDto {
  @IsOptional()
  @IsEnum(AutomationNodeType)
  type?: AutomationNodeType;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}
