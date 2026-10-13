export const FUNNEL_STATS_QUEUE = 'funnel-stats';

export enum FunnelStatsJobName {
  STATS_MONTHLY = 'stats-monthly',
  STATS_RANGE = 'stats-range',
  GUEST_AD_SOURCES = 'guest-ad-sources',
  STATS_TOTAL = 'stats-total',
  DASHBOARD_SUMMARY = 'dashboard-summary',
}

export type FunnelStatsJobPayload =
  | {
      kind: FunnelStatsJobName.STATS_MONTHLY;
      cacheKey: string;
      funnelId: number;
      monthCount: number;
    }
  | {
      kind: FunnelStatsJobName.STATS_RANGE;
      cacheKey: string;
      funnelId: number;
      fromIso: string;
      toIso: string;
      timeZone: string;
    }
  | {
      kind: FunnelStatsJobName.GUEST_AD_SOURCES;
      cacheKey: string;
      funnelId: number;
      from?: string;
      to?: string;
      timezone?: string;
    }
  | {
      kind: FunnelStatsJobName.STATS_TOTAL;
      cacheKey: string;
      funnelId: number;
    }
  | {
      kind: FunnelStatsJobName.DASHBOARD_SUMMARY;
      cacheKey: string;
      funnelId: number;
      fromIso: string;
      toIso: string;
      timeZone: string;
      previousFromIso?: string;
      previousToIso?: string;
    };

export const FUNNEL_STATS_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 50,
};

export const FUNNEL_STATS_CACHE_TTL_SECONDS = 300;
export const FUNNEL_STATS_FRESH_MS = 60_000;
export const FUNNEL_STATS_WAIT_MS = 25_000;
