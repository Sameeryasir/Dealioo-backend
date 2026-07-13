import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { AutomationNodeType } from '../../../db/entities/automation-node.entity';

export class BootstrapAutomationGraphNodeDto {
  @IsEnum(AutomationNodeType)
  type!: AutomationNodeType;

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
  order!: number;
}

export class BootstrapAutomationGraphConnectionDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourceIndex!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  targetIndex!: number;
}

export class BootstrapAutomationGraphDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BootstrapAutomationGraphNodeDto)
  nodes!: BootstrapAutomationGraphNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BootstrapAutomationGraphConnectionDto)
  connections!: BootstrapAutomationGraphConnectionDto[];
}
