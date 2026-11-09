export const CAMPAIGN_REVIEW_CATEGORY_KEYS = [
  'food',
  'service',
  'atmosphere',
] as const;

export type CampaignReviewCategoryKey =
  (typeof CAMPAIGN_REVIEW_CATEGORY_KEYS)[number];

export type CampaignReviewCategoryRatings = Partial<
  Record<CampaignReviewCategoryKey, number>
>;
