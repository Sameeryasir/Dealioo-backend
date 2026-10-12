export const ACTIVITY_STATS_QUEUE = 'activity-stats';

export enum ActivityStatsJobName {
  SUMMARY_MONTHLY = 'summary-monthly',
  SUMMARY_RANGE = 'summary-range',
}

export type ActivityStatsJobPayload =
  | {
      kind: ActivityStatsJobName.SUMMARY_MONTHLY;
      cacheKey: string;
      businessId: number;
      monthCount: number;
    }
  | {
      kind: ActivityStatsJobName.SUMMARY_RANGE;
      cacheKey: string;
      businessId: number;
      fromIso: string;
      toIso: string;
      timeZone: string;
    };

export const ACTIVITY_STATS_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 50,
};

export const ACTIVITY_STATS_CACHE_TTL_SECONDS = 300;
export const ACTIVITY_STATS_FRESH_MS = 60_000;
export const ACTIVITY_STATS_WAIT_MS = 25_000;
