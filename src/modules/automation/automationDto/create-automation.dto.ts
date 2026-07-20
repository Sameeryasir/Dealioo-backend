import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { AutomationPurpose } from '../../../db/entities/automation-purpose.enum';
import { AutomationTrigger } from '../../../db/entities/automation.entity';

const CREATABLE_AUTOMATION_PURPOSES = [
  AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER,
  AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER,
] as const;

export class CreateAutomationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  businessId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  campaignId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(AutomationTrigger)
  trigger: AutomationTrigger;

  @IsIn(CREATABLE_AUTOMATION_PURPOSES)
  purpose: AutomationPurpose;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
