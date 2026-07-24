export const META_PUBLISH_QUEUE = 'meta-publish';

export enum MetaPublishJobName {
  PUBLISH_DRAFT = 'publish-draft',
}

export type MetaPublishJobPayload = {
  businessId: number;
  draftId: string;
  userId: number;
};

export function metaPublishJobId(businessId: number, draftId: string): string {
  return `meta-publish:${businessId}:${draftId}`;
}

export const META_PUBLISH_STEPS = [
  'queued',
  'preparing',
  'campaign',
  'adset',
  'media',
  'creative',
  'ad',
  'done',
] as const;

export type MetaPublishStepName = (typeof META_PUBLISH_STEPS)[number];

export function metaPublishProgressPercent(step: string): number {
  const index = META_PUBLISH_STEPS.indexOf(step as MetaPublishStepName);
  if (index < 0) return 0;
  if (step === 'done') return 100;
  return Math.round((index / (META_PUBLISH_STEPS.length - 1)) * 100);
}
