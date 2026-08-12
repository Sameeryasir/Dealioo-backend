import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type {
  GoogleDestinationTypeId,
  GoogleLeadContactMethodId,
  GoogleSalesChannelId,
  GoogleTrafficActionId,
} from '../../../db/entities/google-campaign-builder-draft.types';

export const GOOGLE_SALES_CHANNELS = [
  'WEBSITE',
  'ONLINE_STORE',
  'PHYSICAL_STORE',
  'PHONE_ORDERS',
  'MULTIPLE',
] as const satisfies readonly GoogleSalesChannelId[];

export const GOOGLE_LEAD_CONTACT_METHODS = [
  'CONTACT_FORM',
  'GOOGLE_LEAD_FORM',
  'PHONE_CALLS',
  'WHATSAPP',
  'APPOINTMENT_BOOKING',
] as const satisfies readonly GoogleLeadContactMethodId[];

export const GOOGLE_TRAFFIC_ACTIONS = [
  'LEARN_MORE',
  'SHOP',
  'READ_MORE',
  'DOWNLOAD',
  'CONTACT_US',
] as const satisfies readonly GoogleTrafficActionId[];

export const GOOGLE_DESTINATION_TYPES = [
  'dealioo_funnel',
  'external_website',
  'google_lead_form',
  'phone',
  'physical_location',
] as const satisfies readonly GoogleDestinationTypeId[];

export class SaveGoogleGoalDetailsStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsOptional()
  @IsIn(GOOGLE_SALES_CHANNELS)
  salesChannel?: GoogleSalesChannelId;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  businessLocation?: string;

  @IsOptional()
  @IsNumber()
  businessLocationLat?: number | null;

  @IsOptional()
  @IsNumber()
  businessLocationLng?: number | null;

  @IsOptional()
  @IsString()
  businessPhone?: string;

  @IsOptional()
  @IsArray()
  @IsIn(GOOGLE_LEAD_CONTACT_METHODS, { each: true })
  leadContactMethods?: GoogleLeadContactMethodId[];

  @IsOptional()
  @IsIn(GOOGLE_DESTINATION_TYPES)
  destinationType?: GoogleDestinationTypeId | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  selectedFunnelId?: number | null;

  @IsOptional()
  @IsString()
  selectedFunnelName?: string;

  @IsOptional()
  @IsString()
  landingPageUrl?: string;

  @IsOptional()
  @IsString()
  phoneCountryCode?: string;

  @IsOptional()
  @IsString()
  whatsAppNumber?: string;

  @IsOptional()
  @IsString()
  whatsAppMessage?: string;

  @IsOptional()
  @IsString()
  bookingPageUrl?: string;

  @IsOptional()
  @IsString()
  googleLeadFormHeadline?: string;

  @IsOptional()
  @IsString()
  googleLeadFormDescription?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  googleLeadFormFields?: string[];

  @IsOptional()
  @IsString()
  googleLeadFormCta?: string;

  @IsOptional()
  @IsString()
  googleLeadFormCtaDescription?: string;

  @IsOptional()
  @IsString()
  googleLeadFormPrivacyUrl?: string;

  @IsOptional()
  @IsString()
  googleLeadFormThankYouHeadline?: string;

  @IsOptional()
  @IsString()
  googleLeadFormThankYouMessage?: string;

  @IsOptional()
  @IsString()
  googleLeadFormPostSubmitAction?: string;

  @IsOptional()
  @IsString()
  googleLeadFormPostSubmitUrl?: string;

  @IsOptional()
  @IsIn(GOOGLE_TRAFFIC_ACTIONS)
  trafficAction?: GoogleTrafficActionId;

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  businessCategory?: string;

  @IsOptional()
  @IsString()
  businessAddress?: string;

  @IsOptional()
  @IsString()
  businessHours?: string;

  @IsOptional()
  @IsString()
  appName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  goalDetailSubstep?: number;
}
