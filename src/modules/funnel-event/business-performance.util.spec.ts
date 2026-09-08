import {
  resolvePerformancePreviousWindow,
  shiftUtcByMonths,
} from './business-performance.util';

describe('business-performance.util', () => {
  describe('shiftUtcByMonths', () => {
    it('clamps day when target month is shorter', () => {
      const from = new Date(Date.UTC(2026, 0, 31, 12, 0, 0));
      const shifted = shiftUtcByMonths(from, 1);
      expect(shifted.toISOString()).toBe('2026-02-28T12:00:00.000Z');
    });
  });

  describe('resolvePerformancePreviousWindow', () => {
    it('maps an open month window to the same days last month', () => {
      const from = new Date(Date.UTC(2026, 8, 1, 0, 0, 0));
      const to = new Date(Date.UTC(2026, 8, 8, 15, 30, 0));
      const window = resolvePerformancePreviousWindow(from, to);
      expect(window).not.toBeNull();
      expect(window!.previousFrom.toISOString()).toBe(
        '2026-08-01T00:00:00.000Z',
      );
      expect(window!.previousTo.toISOString()).toBe(
        '2026-08-08T15:30:00.000Z',
      );
    });

    it('uses equal-length prior window for multi-month ranges', () => {
      const from = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
      const to = new Date(Date.UTC(2026, 8, 1, 0, 0, 0));
      const window = resolvePerformancePreviousWindow(from, to);
      expect(window).not.toBeNull();
      const duration = to.getTime() - from.getTime();
      expect(
        window!.previousTo.getTime() - window!.previousFrom.getTime(),
      ).toBe(duration);
      expect(window!.previousTo.getTime()).toBe(from.getTime() - 1);
    });

    it('returns null when to is before from', () => {
      const from = new Date(Date.UTC(2026, 8, 8));
      const to = new Date(Date.UTC(2026, 8, 1));
      expect(resolvePerformancePreviousWindow(from, to)).toBeNull();
    });
  });
});
