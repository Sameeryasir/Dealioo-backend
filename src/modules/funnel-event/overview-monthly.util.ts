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

export function buildUtcRangeBucketKeys(
  from: Date,
  to: Date,
): { sameDay: boolean; keys: string[] } {
  const sameDay =
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCDate() === to.getUTCDate();

  if (sameDay) {
    const day = from.toISOString().slice(0, 10);
    const keys: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const start = Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate(),
        hour,
      );
      if (start > to.getTime()) break;
      keys.push(`${day}T${String(hour).padStart(2, '0')}`);
    }
    return { sameDay, keys };
  }

  const keys: string[] = [];
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (
    let time = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
    );
    time <= last;
    time += 24 * 60 * 60 * 1000
  ) {
    keys.push(new Date(time).toISOString().slice(0, 10));
  }
  return { sameDay, keys };
}

export function overviewRangeBucketSql(
  columnSql: string,
  sameDay: boolean,
): string {
  return sameDay
    ? `TO_CHAR(DATE_TRUNC('hour', ${columnSql} AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24')`
    : `TO_CHAR(DATE_TRUNC('day', ${columnSql} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
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
