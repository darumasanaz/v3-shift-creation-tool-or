import { WISH_OFFS_STORAGE_KEY } from './storageKeys';
import { WishOffCalendar, WishOffs } from '../types/config';

export { WISH_OFFS_STORAGE_KEY } from './storageKeys';

const isValidDay = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 31;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

const sanitizeDayList = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((day) => (typeof day === 'number' ? day : Number(day)))
        .filter((day) => isValidDay(day)),
    ),
  ).sort((a, b) => a - b);
};

const sanitizeCalendar = (value: unknown): WishOffCalendar => {
  if (!isRecord(value)) return {};
  const result: WishOffCalendar = {};
  Object.entries(value).forEach(([staffId, rawDays]) => {
    if (typeof staffId !== 'string') return;
    const sanitized = sanitizeDayList(rawDays);
    if (sanitized.length > 0) {
      result[staffId] = sanitized;
    }
  });
  return result;
};

export const sanitizeWishOffs = (value: unknown, legacyMonthKey?: string): WishOffs => {
  if (!isRecord(value)) {
    if (legacyMonthKey) {
      const legacyCalendar = sanitizeCalendar(value);
      return Object.keys(legacyCalendar).length > 0 ? { [legacyMonthKey]: legacyCalendar } : {};
    }
    return {};
  }

  const result: WishOffs = {};
  let monthEntryCount = 0;
  Object.entries(value).forEach(([key, raw]) => {
    if (!isRecord(raw)) {
      return;
    }
    const sanitized = sanitizeCalendar(raw);
    if (Object.keys(sanitized).length === 0) {
      return;
    }
    if (MONTH_KEY_PATTERN.test(key)) {
      result[key] = sanitized;
      monthEntryCount += 1;
    } else if (legacyMonthKey && result[legacyMonthKey] === undefined) {
      result[legacyMonthKey] = sanitized;
    }
  });

  if (monthEntryCount === 0 && legacyMonthKey) {
    const fallback = sanitizeCalendar(value);
    if (Object.keys(fallback).length > 0) {
      result[legacyMonthKey] = fallback;
    }
  }

  return result;
};

export const loadWishOffsFromStorage = (): WishOffs => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WISH_OFFS_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeWishOffs(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to load wish offs from storage', error);
    return {};
  }
};

export const saveWishOffsToStorage = (wishOffs: WishOffs) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WISH_OFFS_STORAGE_KEY, JSON.stringify(sanitizeWishOffs(wishOffs)));
  } catch (error) {
    console.warn('Failed to save wish offs to storage', error);
  }
};
