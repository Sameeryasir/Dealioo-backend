import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const MEETING_BUSINESS_ROLES = [
  'business_owner',
  'in_house_marketer',
  'marketing_agency',
  'consultant_partner',
] as const;

export const MEETING_MONTHLY_REVENUE = [
  'under_50k',
  '50k_100k',
  '100k_250k',
  '250k_plus',
  '1m_plus',
  '10m_plus',
] as const;

export const MEETING_MARKETING_ACTIVITIES = [
  'paid_ads',
  'organic_social',
  'influencer',
  'sms_email',
  'loyalty_program',
  'other',
] as const;

export const MEETING_START_TIMELINES = [
  'immediately',
  'one_to_three_months',
  'just_exploring',
] as const;

export const MEETING_COMMITMENTS = ['yes', 'not_sure'] as const;

export class CreateMeetingRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName: string;

  @IsString()
  @MinLength(5)
  @MaxLength(40)
  phone: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.length > 0)
  @IsIn([...MEETING_BUSINESS_ROLES])
  businessRole?: (typeof MEETING_BUSINESS_ROLES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  businessCategory: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  businessName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  cityLocation: string;

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.length > 0)
  @IsIn([...MEETING_MONTHLY_REVENUE])
  monthlyRevenue?: (typeof MEETING_MONTHLY_REVENUE)[number];

  @IsOptional()
  @ValidateIf((_, value) => Array.isArray(value) && value.length > 0)
  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...MEETING_MARKETING_ACTIVITIES], { each: true })
  marketingActivities?: (typeof MEETING_MARKETING_ACTIVITIES)[number][];

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.trim().length > 0)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  currentSituation?: string;

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.length > 0)
  @IsIn([...MEETING_START_TIMELINES])
  startTimeline?: (typeof MEETING_START_TIMELINES)[number];

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.length > 0)
  @IsIn([...MEETING_COMMITMENTS])
  meetingCommitment?: (typeof MEETING_COMMITMENTS)[number];

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.length > 0)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledDate?: string;

  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.length > 0)
  @Matches(/^\d{2}:\d{2}$/)
  scheduledTime?: string;

  @IsOptional()
  @IsInt()
  @IsIn([15, 30])
  scheduledDuration?: 15 | 30;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scheduledTimeZone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  businessPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  businessEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
}
