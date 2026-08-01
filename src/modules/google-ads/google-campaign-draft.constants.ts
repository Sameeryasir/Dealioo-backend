export const GoogleCampaignDraftStatus = {
  DRAFT: 'DRAFT',
  VALIDATING: 'VALIDATING',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type GoogleCampaignDraftStatusValue =
  (typeof GoogleCampaignDraftStatus)[keyof typeof GoogleCampaignDraftStatus];

export const GOOGLE_DRAFT_EDITABLE_STATUSES: GoogleCampaignDraftStatusValue[] = [
  GoogleCampaignDraftStatus.DRAFT,
  GoogleCampaignDraftStatus.FAILED,
];

export const DRAFT_CONFLICT_MESSAGE =
  'This draft has been modified elsewhere. Please refresh.';
