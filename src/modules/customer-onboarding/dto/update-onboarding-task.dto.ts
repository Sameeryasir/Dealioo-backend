import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ONBOARDING_TASK_STATUS } from '../customer-onboarding.constants';

const TASK_STATUS_VALUES = Object.values(ONBOARDING_TASK_STATUS);

export class UpdateOnboardingTaskDto {
  @IsIn(TASK_STATUS_VALUES)
  status: (typeof TASK_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
