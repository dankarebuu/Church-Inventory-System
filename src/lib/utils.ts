import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Normalizes legacy inventory `image_filename` values (JSON array string,
 * plain URL string, or string array) into a trimmed list of non-empty URLs.
 */
export function parseImages(imgData: unknown): string[] {
  if (!imgData) return [];

  if (Array.isArray(imgData)) {
    return imgData
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .map((url) => url.trim());
  }

  if (typeof imgData !== 'string') return [];
  const value = imgData.trim();
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
        .map((url) => url.trim());
    }
    if (typeof parsed === 'string' && parsed.trim().length > 0) {
      return [parsed.trim()];
    }
    return [];
  } catch {
    return [value];
  }
}

/**
 * Extracts the local-part prefix from an email address, falling back to `'User'`.
 */
export function getUserEmailPrefix(email?: string | null): string {
  if (typeof email !== 'string') return 'User';
  const trimmed = email.trim();
  if (!trimmed) return 'User';
  const prefix = trimmed.includes('@') ? trimmed.split('@')[0].trim() : trimmed;
  return prefix || 'User';
}

/**
 * Derives 1-2 uppercase avatar initials from a display name, falling back to `'?'`.
 */
export function getInitials(name?: string | null): string {
  if (typeof name !== 'string' || !name.trim()) return '?';

  const alphaParts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);

  if (alphaParts.length >= 2) {
    return `${alphaParts[0][0]}${alphaParts[alphaParts.length - 1][0]}`.toUpperCase();
  }

  const cleanName = alphaParts[0] ?? '';
  if (cleanName.length >= 2) return cleanName.slice(0, 2).toUpperCase();
  if (cleanName.length === 1) return cleanName.toUpperCase();
  return '?';
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a Date, ISO timestamp, or `YYYY-MM-DD` string into a human-readable
 * local date (e.g. `November 18, 2026`), preserving unparseable legacy strings.
 */
export function formatDisplayDate(date?: Date | string | null): string {
  if (!date) return '—';

  let parsed: Date;
  if (date instanceof Date) {
    parsed = date;
  } else {
    const trimmed = date.trim();
    if (!trimmed) return '—';
    const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmed);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]) - 1;
      const day = Number(dateOnlyMatch[3]);
      parsed = new Date(year, month, day);
    } else {
      parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        return trimmed;
      }
    }
  }

  if (Number.isNaN(parsed.getTime())) return '—';

  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Checks whether an ISO timestamp falls on the same local calendar day as
 * `referenceDate` (defaults to now), avoiding UTC midnight boundary bugs.
 */
export function isSameLocalDay(isoString?: string | null, referenceDate: Date = new Date()): boolean {
  if (typeof isoString !== 'string' || !isoString.trim()) return false;
  const target = new Date(isoString);
  if (Number.isNaN(target.getTime()) || Number.isNaN(referenceDate.getTime())) return false;

  return (
    target.getFullYear() === referenceDate.getFullYear() &&
    target.getMonth() === referenceDate.getMonth() &&
    target.getDate() === referenceDate.getDate()
  );
}

/**
 * Trims a string value and converts blank or non-string inputs to `null`.
 */
export function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface PostgresErrorLike {
  code?: string;
  message?: string;
}

/**
 * Checks whether a Supabase/PostgREST error represents a Postgres `23505`
 * unique-constraint violation.
 */
export function isUniqueConstraintError(error: PostgresErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return typeof error.message === 'string' && /duplicate key|unique constraint/i.test(error.message);
}
