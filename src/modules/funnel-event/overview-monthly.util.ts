/**
 * Change summary:
 * - What: Timezone-aware day/hour chart buckets (viewer calendar, not UTC-only).
 * - Why: Month view mixed local from/to with UTC buckets, so “today” and day
 *   labels could shift or include the wrong previous-month day across zones.
 * - Related: activity.service, funnel-event/analytics range charts.
 * - MCP context 7: validate IANA zone before embedding in SQL; default UTC.
 */

export const DEFAULT_OVERVIEW_MONTHS = 6;
export const MAX_OVERVIEW_MONTHS = 120;

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
  return Math.min(MAX_OVERVIEW_MONTHS, Math.max(1, Math.floor(parsed)));
}

export function formatMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// --- Timezone helpers (IANA only; invalid → UTC) ---

export function resolveSafeTimeZone(raw?: string | null): string {
  const candidate = (raw ?? 'UTC').trim() || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveSafeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((part) => part.type === type)?.value;
    return Number(raw);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
  };
}

/**
 * Build chart bucket keys in the viewer's calendar (day or hour).
 * Month view always includes every local day from `from` through `to`
 * (so “today” is present when the frontend ends the range at end-of-today).
 */
export function buildZonedRangeBucketKeys(
  from: Date,
  to: Date,
  timeZone: string = 'UTC',
): { sameDay: boolean; keys: string[] } {
  const tz = resolveSafeTimeZone(timeZone);
  const start = getZonedParts(from, tz);
  const end = getZonedParts(to, tz);
  const sameDay =
    start.year === end.year &&
    start.month === end.month &&
    start.day === end.day;

  if (sameDay) {
    const keys: string[] = [];
    const dayPrefix = `${start.year}-${pad2(start.month)}-${pad2(start.day)}`;
    for (let hour = start.hour; hour <= end.hour; hour += 1) {
      keys.push(`${dayPrefix}T${pad2(hour)}`);
    }
    return { sameDay: true, keys };
  }

  // --- Multi-day: walk civil calendar dates in the viewer zone ---
  const keys: string[] = [];
  let year = start.year;
  let month = start.month;
  let day = start.day;

  for (let guard = 0; guard < 400; guard += 1) {
    keys.push(`${year}-${pad2(month)}-${pad2(day)}`);
    if (year === end.year && month === end.month && day === end.day) {
      break;
    }
    // Increment using UTC date math on Y-M-D components (DST-safe for keys).
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }

  return { sameDay: false, keys };
}

/** @deprecated Prefer buildZonedRangeBucketKeys with an explicit IANA zone. */
export function buildUtcRangeBucketKeys(
  from: Date,
  to: Date,
): { sameDay: boolean; keys: string[] } {
  return buildZonedRangeBucketKeys(from, to, 'UTC');
}

export function overviewRangeBucketSql(
  columnSql: string,
  sameDay: boolean,
  timeZone: string = 'UTC',
): string {
  // Zone already validated — escape quotes before embedding in SQL.
  const tz = resolveSafeTimeZone(timeZone).replace(/'/g, "''");
  return sameDay
    ? `TO_CHAR(DATE_TRUNC('hour', ${columnSql} AT TIME ZONE '${tz}'), 'YYYY-MM-DD"T"HH24')`
    : `TO_CHAR(DATE_TRUNC('day', ${columnSql} AT TIME ZONE '${tz}'), 'YYYY-MM-DD')`;
}

export function buildRecentMonthBuckets(
  monthCount: number,
): OverviewMonthBucket[] {
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
