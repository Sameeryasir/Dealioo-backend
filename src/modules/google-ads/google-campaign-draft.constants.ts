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

export const GoogleCampaignPublishStatus = {
  QUEUED: 'QUEUED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
} as const;

export type GoogleCampaignPublishStatusValue =
  (typeof GoogleCampaignPublishStatus)[keyof typeof GoogleCampaignPublishStatus];

export const GOOGLE_DRAFT_EDITABLE_STATUSES: GoogleCampaignDraftStatusValue[] = [
  GoogleCampaignDraftStatus.DRAFT,
  GoogleCampaignDraftStatus.FAILED,
];

export const DRAFT_CONFLICT_MESSAGE =
  'This draft has been modified elsewhere. Please refresh.';

export const GOOGLE_PUBLISH_STALE_MS = 15 * 60 * 1000;

export { googlePublishJobId } from './google-publish-queue.constants';
