import { describe, it, expect } from 'vitest';
import {
  cn,
  parseImages,
  getUserEmailPrefix,
  getInitials,
  formatDisplayDate,
  isSameLocalDay,
} from './utils';

describe('utils', () => {
  it('merges and deduplicates Tailwind utility classes via cn', () => {
    expect(cn('px-2 py-1 text-sm', 'px-4 font-medium')).toBe('py-1 text-sm px-4 font-medium');
    expect(cn('block', false && 'hidden', undefined, null, 'mt-2')).toBe('block mt-2');
  });

  it('parses JSON array, single string, array, and invalid inputs safely', () => {
    expect(parseImages('["https://a.com/1.jpg", " "]')).toEqual(['https://a.com/1.jpg']);
    expect(parseImages('https://a.com/1.jpg')).toEqual(['https://a.com/1.jpg']);
    expect(parseImages([' https://a.com/2.jpg ', ''])).toEqual(['https://a.com/2.jpg']);
    expect(parseImages(null)).toEqual([]);
    expect(parseImages('   ')).toEqual([]);
  });

  it('extracts user email prefix with safe fallback', () => {
    expect(getUserEmailPrefix('dan.caleb@wingmacc.org')).toBe('dan.caleb');
    expect(getUserEmailPrefix('member_handle')).toBe('member_handle');
    expect(getUserEmailPrefix('')).toBe('User');
    expect(getUserEmailPrefix(null)).toBe('User');
  });

  it('computes initials from full name or single word', () => {
    expect(getInitials('Dan Caleb')).toBe('DC');
    expect(getInitials('Dan')).toBe('DA');
    expect(getInitials('D')).toBe('D');
    expect(getInitials('')).toBe('?');
    expect(getInitials(null)).toBe('?');
  });

  it('formats dates for display safely without off-by-one shifts on YYYY-MM-DD', () => {
    expect(formatDisplayDate(new Date(2026, 10, 18))).toBe('November 18, 2026');
    expect(formatDisplayDate('2026-11-18')).toBe('November 18, 2026');
    expect(formatDisplayDate(null)).toBe('—');
    expect(formatDisplayDate('')).toBe('—');
  });

  it('checks local day boundaries accurately', () => {
    const ref = new Date(2026, 10, 18, 10, 30, 0);
    const sameMorning = new Date(2026, 10, 18, 0, 5, 0).toISOString();
    const sameLateNight = new Date(2026, 10, 18, 23, 59, 0).toISOString();
    const yesterday = new Date(2026, 10, 17, 23, 55, 0).toISOString();
    expect(isSameLocalDay(sameMorning, ref)).toBe(true);
    expect(isSameLocalDay(sameLateNight, ref)).toBe(true);
    expect(isSameLocalDay(yesterday, ref)).toBe(false);
    expect(isSameLocalDay(null, ref)).toBe(false);
    expect(isSameLocalDay('not-a-date', ref)).toBe(false);
  });
});
