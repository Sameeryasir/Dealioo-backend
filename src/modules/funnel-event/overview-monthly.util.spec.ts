import {
  buildZonedRangeBucketKeys,
  clampOverviewMonths,
  DEFAULT_OVERVIEW_MONTHS,
  MAX_OVERVIEW_MONTHS,
  overviewRangeBucketSql,
  resolveSafeTimeZone,
} from './overview-monthly.util';

describe('overview-monthly.util', () => {
  describe('clampOverviewMonths', () => {
    it('falls back to default for non-numeric input', () => {
      expect(clampOverviewMonths(undefined)).toBe(DEFAULT_OVERVIEW_MONTHS);
      expect(clampOverviewMonths('abc')).toBe(DEFAULT_OVERVIEW_MONTHS);
    });

    it('clamps to 1..MAX', () => {
      expect(clampOverviewMonths(0)).toBe(1);
      expect(clampOverviewMonths(-3)).toBe(1);
      expect(clampOverviewMonths(MAX_OVERVIEW_MONTHS + 50)).toBe(
        MAX_OVERVIEW_MONTHS,
      );
      expect(clampOverviewMonths(12.9)).toBe(12);
    });
  });

  describe('resolveSafeTimeZone', () => {
    it('keeps valid IANA zones and falls back for garbage', () => {
      expect(resolveSafeTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
      expect(resolveSafeTimeZone('Not/AZone')).toBe('UTC');
      expect(resolveSafeTimeZone('')).toBe('UTC');
      expect(resolveSafeTimeZone(null)).toBe('UTC');
    });
  });

  describe('buildZonedRangeBucketKeys', () => {
    it('builds hourly keys for a single local calendar day', () => {
      const from = new Date('2025-06-15T00:00:00+05:00');
      const to = new Date('2025-06-15T23:59:59.999+05:00');
      const { sameDay, keys } = buildZonedRangeBucketKeys(
        from,
        to,
        'Asia/Karachi',
      );

      expect(sameDay).toBe(true);
      expect(keys).toHaveLength(24);
      expect(keys[0]).toBe('2025-06-15T00');
      expect(keys[keys.length - 1]).toBe('2025-06-15T23');
    });

    it('builds daily keys across a multi-day range in viewer TZ', () => {
      const from = new Date('2025-06-01T00:00:00+05:00');
      const to = new Date('2025-06-03T23:59:59.999+05:00');
      const { sameDay, keys } = buildZonedRangeBucketKeys(
        from,
        to,
        'Asia/Karachi',
      );

      expect(sameDay).toBe(false);
      expect(keys).toEqual(['2025-06-01', '2025-06-02', '2025-06-03']);
    });

    // NOTE: silent data loss — ranges longer than 400 days stop early.
    it('truncates at 400 daily keys (dashboard long-range footgun)', () => {
      const from = new Date('2024-01-01T00:00:00.000Z');
      const to = new Date('2026-12-31T23:59:59.999Z');
      const { keys } = buildZonedRangeBucketKeys(from, to, 'Asia/Karachi');

      expect(keys).toHaveLength(400);
      expect(keys[0]).toBe('2024-01-01');
      expect(keys[keys.length - 1]).toBe('2025-02-03');
      expect(keys.includes('2025-10-01')).toBe(false);
    });
  });

  describe('overviewRangeBucketSql', () => {
    it('uses hour truncation for same-day and day truncation otherwise', () => {
      expect(overviewRangeBucketSql('e.created_at', true, 'UTC')).toContain(
        "DATE_TRUNC('hour'",
      );
      expect(overviewRangeBucketSql('e.created_at', false, 'UTC')).toContain(
        "DATE_TRUNC('day'",
      );
    });
  });
});
