import { trimOrNull } from '@/lib/utils';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CheckOffFreshnessSummary {
  checkedLast7Days: number;
  totalItems: number;
  freshPercent: number;
}

export interface CheckOffTrendPoint {
  dateKey: string;
  shortLabel: string;
  count: number;
}

export interface CheckOffTrendSummary {
  points: CheckOffTrendPoint[];
  totalInWindow: number;
  roundedDailyAverage: number;
  peakCount: number;
  todayCount: number;
}

/**
 * Formats a `part / total` ratio as a clamped whole-number percentage (`0–100`).
 */
export function formatWholePercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const safePart = Math.max(0, part);
  return Math.min(100, Math.round((safePart / total) * 100));
}

/**
 * Formats an integer count cleanly: exact integers under `1,000` and rounded
 * compact notation (`1.2k`, `2k`, `1.5m`) at `1,000` and above.
 */
export function formatCompactCount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (safe < 1000) {
    return String(safe);
  }
  if (safe < 1_000_000) {
    const scaled = (safe / 1000).toFixed(1).replace(/\.0$/, '');
    if (scaled === '1000') {
      return '1m';
    }
    return `${scaled}k`;
  }
  const millions = (safe / 1_000_000).toFixed(1).replace(/\.0$/, '');
  return `${millions}m`;
}

/**
 * Formats a `Date` as a local `YYYY-MM-DD` calendar key.
 */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses an item `checked_at` timestamp or date-only string into a local `Date`.
 */
export function parseItemCheckedDate(checkedAt?: string | null): Date | null {
  const trimmed = trimOrNull(checkedAt);
  if (!trimmed) return null;

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const localDate = new Date(year, month, day, 12, 0, 0, 0);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Computes how many items were checked off within the trailing 7 local calendar days
 * (including today) using only `items[].checked_at` so Guests and Staff see identical data.
 */
export function computeCheckOffFreshness(
  items: readonly { checked_at?: string | null }[],
  now: Date = new Date()
): CheckOffFreshnessSummary {
  const totalItems = items.length;
  if (totalItems === 0 || Number.isNaN(now.getTime())) {
    return { checkedLast7Days: 0, totalItems, freshPercent: 0 };
  }

  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let checkedLast7Days = 0;
  for (const item of items) {
    const parsed = parseItemCheckedDate(item.checked_at);
    if (!parsed) continue;
    if (parsed.getTime() >= windowStart.getTime() && parsed.getTime() <= windowEnd.getTime()) {
      checkedLast7Days += 1;
    }
  }

  return {
    checkedLast7Days,
    totalItems,
    freshPercent: formatWholePercent(checkedLast7Days, totalItems),
  };
}

/**
 * Aggregates `items[].checked_at` into a trailing N-day daily series for the
 * dashboard check-off regularity chart.
 */
export function buildCheckOffTrend(
  items: readonly { checked_at?: string | null }[],
  days = 14,
  now: Date = new Date()
): CheckOffTrendSummary {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 14;
  const reference = Number.isNaN(now.getTime()) ? new Date() : now;

  const points: CheckOffTrendPoint[] = [];
  const indexByKey = new Map<string, number>();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const dayDate = new Date(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate() - offset,
      12,
      0,
      0,
      0
    );
    const dateKey = toLocalDateKey(dayDate);
    const shortLabel =
      offset === 0
        ? 'Today'
        : dayDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
    indexByKey.set(dateKey, points.length);
    points.push({ dateKey, shortLabel, count: 0 });
  }

  for (const item of items) {
    const parsed = parseItemCheckedDate(item.checked_at);
    if (!parsed) continue;
    const key = toLocalDateKey(parsed);
    const idx = indexByKey.get(key);
    if (idx !== undefined) {
      points[idx].count += 1;
    }
  }

  let totalInWindow = 0;
  let peakCount = 0;
  for (const point of points) {
    totalInWindow += point.count;
    if (point.count > peakCount) {
      peakCount = point.count;
    }
  }

  const todayCount = points[points.length - 1]?.count ?? 0;

  return {
    points,
    totalInWindow,
    roundedDailyAverage: Math.round(totalInWindow / safeDays),
    peakCount,
    todayCount,
  };
}

/**
 * Sorts health breakdown buckets so groups needing attention surface first
 * (lowest readiness percentage, then most flagged items, then largest item count).
 * Empty groups always sort after populated groups.
 */
export function sortHealthBucketsForAttention<
  T extends { healthPercent: number; flaggedCount: number; itemCount: number; name: string },
>(buckets: readonly T[]): T[] {
  return [...buckets].sort((a, b) => {
    const aHasItems = a.itemCount > 0 ? 1 : 0;
    const bHasItems = b.itemCount > 0 ? 1 : 0;
    if (aHasItems !== bHasItems) {
      return bHasItems - aHasItems;
    }
    if (a.healthPercent !== b.healthPercent) {
      return a.healthPercent - b.healthPercent;
    }
    if (a.flaggedCount !== b.flaggedCount) {
      return b.flaggedCount - a.flaggedCount;
    }
    if (a.itemCount !== b.itemCount) {
      return b.itemCount - a.itemCount;
    }
    return a.name.localeCompare(b.name);
  });
}
