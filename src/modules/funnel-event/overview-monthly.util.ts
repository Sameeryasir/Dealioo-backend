export const DEFAULT_OVERVIEW_MONTHS = 6;
export const MAX_OVERVIEW_MONTHS = 12;

export type OverviewMonthBucket = {
  month: string;
  start: Date;
  end: Date;
};

export function clampOverviewMonths(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OVERVIEW_MONTHS;
  }
  return Math.min(
    MAX_OVERVIEW_MONTHS,
    Math.max(1, Math.floor(parsed)),
  );
}

export function formatMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function buildRecentMonthBuckets(monthCount: number): OverviewMonthBucket[] {
  const now = new Date();
  const buckets: OverviewMonthBucket[] = [];

  for (let offset = monthCount - 1; offset >= 0; offset--) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
    buckets.push({
      month: formatMonthKey(start),
      start,
      end,
    });
  }

  return buckets;
}

export function monthKeyToMap<T extends { month: string }>(
  rows: T[],
): Map<string, T> {
  return new Map(rows.map((row) => [row.month, row]));
}
