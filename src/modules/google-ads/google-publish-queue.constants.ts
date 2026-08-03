export const GOOGLE_PUBLISH_QUEUE = 'google-publish';

export enum GooglePublishJobName {
  PUBLISH_DRAFT = 'publish-draft',
}

export type GooglePublishJobPayload = {
  businessId: number;
  draftId: string;
  userId: number;
};

export function googlePublishJobId(businessId: number, draftId: string): string {
  return `google-publish-${businessId}-${draftId}`;
}

export const GOOGLE_PUBLISH_STEPS = [
  'queued',
  'preparing',
  'budget',
  'campaign',
  'ad_group',
  'keywords',
  'ads',
  'done',
] as const;

export type GooglePublishStepName = (typeof GOOGLE_PUBLISH_STEPS)[number];

export function googlePublishProgressPercent(step: string): number {
  const index = GOOGLE_PUBLISH_STEPS.indexOf(step as GooglePublishStepName);
  if (index < 0) return 0;
  if (step === 'done') return 100;
  return Math.round((index / (GOOGLE_PUBLISH_STEPS.length - 1)) * 100);
}
