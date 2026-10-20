import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  MEETING_ATTENDANCE,
  MEETING_SALES_OUTCOME,
} from '../customer-onboarding.constants';

const ATTENDANCE_VALUES = Object.values(MEETING_ATTENDANCE);
const SALES_OUTCOME_VALUES = Object.values(MEETING_SALES_OUTCOME);

export class UpdateMeetingOutcomeDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(ATTENDANCE_VALUES)
  attendance?: (typeof ATTENDANCE_VALUES)[number] | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(SALES_OUTCOME_VALUES)
  salesOutcome?: (typeof SALES_OUTCOME_VALUES)[number] | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  meetingNotes?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  followUpNotes?: string | null;
}
