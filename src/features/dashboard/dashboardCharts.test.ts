import { describe, expect, it } from 'vitest';
import {
  buildCheckOffTrend,
  computeCheckOffFreshness,
  formatCompactCount,
  formatWholePercent,
  parseItemCheckedDate,
  sortHealthBucketsForAttention,
} from './dashboardCharts';

describe('dashboardCharts helpers', () => {
  describe('formatWholePercent', () => {
    it('rounds ratios cleanly to 0–100 integers and guards zero/invalid denominators', () => {
      expect(formatWholePercent(71, 73)).toBe(97);
      expect(formatWholePercent(2, 4)).toBe(50);
      expect(formatWholePercent(4, 4)).toBe(100);
      expect(formatWholePercent(10, 4)).toBe(100);
      expect(formatWholePercent(-3, 10)).toBe(0);
      expect(formatWholePercent(5, 0)).toBe(0);
      expect(formatWholePercent(Number.NaN, 10)).toBe(0);
    });
  });

  describe('formatCompactCount', () => {
    it('keeps exact integers under 1,000 and rounds compact k/m suffixes at >= 1,000', () => {
      expect(formatCompactCount(0)).toBe('0');
      expect(formatCompactCount(73)).toBe('73');
      expect(formatCompactCount(999)).toBe('999');
      expect(formatCompactCount(1000)).toBe('1k');
      expect(formatCompactCount(1240)).toBe('1.2k');
      expect(formatCompactCount(1260)).toBe('1.3k');
      expect(formatCompactCount(1500000)).toBe('1.5m');
      expect(formatCompactCount(-5)).toBe('0');
      expect(formatCompactCount(Number.NaN)).toBe('0');
    });
  });

  describe('parseItemCheckedDate', () => {
    it('parses YYYY-MM-DD and ISO timestamps cleanly and rejects blank/invalid values', () => {
      const dateOnly = parseItemCheckedDate('2026-11-20');
      expect(dateOnly).not.toBeNull();
      expect(dateOnly?.getFullYear()).toBe(2026);
      expect(dateOnly?.getMonth()).toBe(10);
      expect(dateOnly?.getDate()).toBe(20);

      expect(parseItemCheckedDate('2026-11-23T09:15:00.000Z')).not.toBeNull();
      expect(parseItemCheckedDate(null)).toBeNull();
      expect(parseItemCheckedDate('   ')).toBeNull();
      expect(parseItemCheckedDate('not-a-date')).toBeNull();
    });
  });

  describe('computeCheckOffFreshness', () => {
    it('counts items checked within the trailing 7 local calendar days including today', () => {
      const now = new Date(2026, 10, 23, 14, 0, 0); // Nov 23, 2026
      const summary = computeCheckOffFreshness(
        [
          { checked_at: '2026-11-23T08:00:00' }, // today (day 0)
          { checked_at: '2026-11-17T09:00:00' }, // 6 days ago (included)
          { checked_at: '2026-11-16T23:59:00' }, // 7 days ago (excluded)
          { checked_at: null }, // never checked
        ],
        now
      );

      expect(summary).toEqual({
        checkedLast7Days: 2,
        totalItems: 4,
        freshPercent: 50,
      });
    });

    it('returns zeros when inventory is empty', () => {
      expect(computeCheckOffFreshness([], new Date(2026, 10, 23, 12, 0, 0))).toEqual({
        checkedLast7Days: 0,
        totalItems: 0,
        freshPercent: 0,
      });
    });
  });

  describe('buildCheckOffTrend', () => {
    it('aggregates trailing 14 days cleanly with rounded daily average, peak, and today count', () => {
      const now = new Date(2026, 10, 23, 14, 0, 0);
      const trend = buildCheckOffTrend(
        [
          { checked_at: '2026-11-23T10:00:00' },
          { checked_at: '2026-11-23T11:00:00' },
          { checked_at: '2026-11-20T09:00:00' },
          { checked_at: '2026-11-20T10:00:00' },
          { checked_at: '2026-11-20T11:00:00' },
          { checked_at: '2026-11-10T09:00:00' }, // day 0 of 14-day window (Nov 10..23)
          { checked_at: '2026-11-01T09:00:00' }, // outside window
          { checked_at: null },
        ],
        14,
        now
      );

      expect(trend.points).toHaveLength(14);
      expect(trend.points[0].dateKey).toBe('2026-11-10');
      expect(trend.points[13]).toEqual({
        dateKey: '2026-11-23',
        shortLabel: 'Today',
        count: 2,
      });
      expect(trend.totalInWindow).toBe(6);
      expect(trend.peakCount).toBe(3);
      expect(trend.todayCount).toBe(2);
      expect(trend.roundedDailyAverage).toBe(0); // Math.round(6/14) = 0

      // Higher volume verifies non-zero rounded integer daily average
      const denseItems = Array.from({ length: 20 }, (_, i) => ({
        checked_at: i % 2 === 0 ? '2026-11-23T09:00:00' : '2026-11-21T09:00:00',
      }));
      const denseTrend = buildCheckOffTrend(denseItems, 14, now);
      expect(denseTrend.totalInWindow).toBe(20);
      expect(denseTrend.roundedDailyAverage).toBe(1); // Math.round(20/14) = 1
    });
  });

  describe('sortHealthBucketsForAttention', () => {
    it('surfaces lowest readiness first and keeps empty groups at the bottom', () => {
      const sorted = sortHealthBucketsForAttention([
        { name: 'Instruments', healthPercent: 100, flaggedCount: 0, itemCount: 5 },
        { name: 'Empty Rig', healthPercent: 100, flaggedCount: 0, itemCount: 0 },
        { name: 'DI Boxes', healthPercent: 50, flaggedCount: 1, itemCount: 2 },
        { name: 'Cables', healthPercent: 50, flaggedCount: 3, itemCount: 6 },
      ]);

      expect(sorted.map((b) => b.name)).toEqual([
        'Cables',
        'DI Boxes',
        'Instruments',
        'Empty Rig',
      ]);
    });
  });
});
