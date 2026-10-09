export const DEFAULT_ADS_INSIGHTS_PERIOD = 'this_month' as const;

export type AdsMonthBounds = {
  since: string;
  until: string;
};

export type ParsedAdsMonthPeriod = {
  year: number;
  month: number;
  key: string;
};

export function normalizeAdsInsightsPeriodInput(
  raw?: string | null,
  fallback: string = DEFAULT_ADS_INSIGHTS_PERIOD,
): string {
  const value = (raw ?? fallback).trim().toLowerCase();
  return value.length > 0 ? value : fallback;
}

export function isAdsMaximumPeriod(value: string): boolean {
  return (
    value === 'maximum' ||
    value === 'all_time' ||
    value === 'data_maximum'
  );
}

export function adsMonthBounds(year: number, month: number): AdsMonthBounds {
  const since = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const until = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { since, until };
}

export function parseAdsMonthPeriod(
  value: string,
): ParsedAdsMonthPeriod | null {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!monthMatch) return null;
  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return { year, month, key };
}

export function adsMonthSnapshotKey(monthKey: string): string {
  return `m:${monthKey}`;
}
