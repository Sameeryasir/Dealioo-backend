import type {
  GoogleCampaignBuilderDraftData,
  GoogleCampaignGoalId,
  GoogleDestinationTypeId,
  GoogleLeadContactMethodId,
  GoogleSalesChannelId,
  GoogleTrafficActionId,
} from '../../../db/entities/google-campaign-builder-draft.types';

export class SaveGoogleGoalStepResponseDto {
  id: string;
  businessId: number;
  goal: GoogleCampaignGoalId;
  campaignName: string | null;
  currentStep: number;
  completedSteps: number[];
  version: number;
  lastSavedAt: Date | null;
}

export type SaveGoogleGoalDetailsStepResponseDto = {
  id: string;
  businessId: number;
  goal: GoogleCampaignGoalId;
  currentStep: number;
  completedSteps: number[];
  version: number;
  lastSavedAt: Date | null;
  campaignName: string | null;
  salesChannel?: GoogleSalesChannelId;
  websiteUrl?: string;
  businessLocation?: string;
  businessPhone?: string;
  leadContactMethods?: GoogleLeadContactMethodId[];
  landingPageUrl?: string;
  destinationType?: GoogleDestinationTypeId | null;
  selectedFunnelId?: number | null;
  selectedFunnelName?: string;
  trafficAction?: GoogleTrafficActionId;
  businessName?: string;
  businessCategory?: string;
  businessAddress?: string;
  businessHours?: string;
  appName?: string;
};

export type SaveGoogleCampaignInfoStepResponseDto = {
  id: string;
  businessId: number;
  currentStep: number;
  completedSteps: number[];
  version: number;
  lastSavedAt: Date | null;
  campaignName: string;
  businessName: string;
  websiteUrl?: string;
  businessCategory?: string;
  logoFileName?: string;
  logoPreviewUrl?: string;
};

export type GoogleCampaignDraftResumeResponseDto = {
  id: string;
  businessId: number;
  status: string;
  currentStep: number;
  completedSteps: number[];
  version: number;
  lastSavedAt: Date | null;
  campaignName: string | null;
  goal: GoogleCampaignGoalId | null;
  draftData: GoogleCampaignBuilderDraftData | null;
  publishStatus?: string | null;
  publishStep?: string | null;
  publishProgress?: number | null;
  errorMessage?: string | null;
  updatedAt?: Date | null;
};

export type GoogleCampaignDraftListItemDto = {
  id: string;
  businessId: number;
  status: string;
  currentStep: number;
  completedSteps: number[];
  version: number;
  lastSavedAt: Date | null;
  campaignName: string | null;
  goal: GoogleCampaignGoalId | null;
  publishStatus: string | null;
  publishStep: string | null;
  publishProgress: number | null;
  errorMessage: string | null;
  updatedAt: Date;
  logoPreviewUrl: string | null;
  selectedFunnelName: string | null;
};
