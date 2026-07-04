import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
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

  @IsIn([...MEETING_BUSINESS_ROLES])
  businessRole: (typeof MEETING_BUSINESS_ROLES)[number];

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

  @IsIn([...MEETING_MONTHLY_REVENUE])
  monthlyRevenue: (typeof MEETING_MONTHLY_REVENUE)[number];

  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...MEETING_MARKETING_ACTIVITIES], { each: true })
  marketingActivities: (typeof MEETING_MARKETING_ACTIVITIES)[number][];

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  currentSituation: string;

  @IsIn([...MEETING_START_TIMELINES])
  startTimeline: (typeof MEETING_START_TIMELINES)[number];

  @IsIn([...MEETING_COMMITMENTS])
  meetingCommitment: (typeof MEETING_COMMITMENTS)[number];
}
