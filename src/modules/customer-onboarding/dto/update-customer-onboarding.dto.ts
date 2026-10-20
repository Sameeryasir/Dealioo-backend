import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { CUSTOMER_ONBOARDING_STATUS } from '../customer-onboarding.constants';

const STATUS_VALUES = [
  CUSTOMER_ONBOARDING_STATUS.NOT_STARTED,
  CUSTOMER_ONBOARDING_STATUS.IN_PROGRESS,
  CUSTOMER_ONBOARDING_STATUS.READY_FOR_REVIEW,
  CUSTOMER_ONBOARDING_STATUS.ON_HOLD,
  CUSTOMER_ONBOARDING_STATUS.CANCELLED,
] as const;

export class UpdateCustomerOnboardingDto {
  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: (typeof STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNotes?: string | null;

  @IsOptional()
  @IsObject()
  draftPayload?: Record<string, unknown> | null;
}
