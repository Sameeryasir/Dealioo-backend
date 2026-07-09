import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { AutomationPurpose } from '../../../db/entities/automation-purpose.enum';
import { AutomationTrigger } from '../../../db/entities/automation.entity';

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(AutomationTrigger)
  trigger?: AutomationTrigger;

  @IsOptional()
  @IsEnum(AutomationPurpose)
  purpose?: AutomationPurpose;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  businessId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  campaignId?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isTemplate?: boolean;
}
