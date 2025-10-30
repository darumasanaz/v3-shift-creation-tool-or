import { WishOffs } from '../types/config';

export const WISH_OFFS_STORAGE_KEY = 'shift-wishoffs-2025-12';

const isValidDay = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 31;

export const sanitizeWishOffs = (value: unknown): WishOffs => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result: WishOffs = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [staffId, rawDays] of entries) {
    if (typeof staffId !== 'string') continue;
    if (!Array.isArray(rawDays)) {
      result[staffId] = [];
      continue;
    }
    const sanitized = Array.from(
      new Set(
        rawDays
          .map((day) => (typeof day === 'number' ? day : Number(day)))
          .filter((day) => isValidDay(day)),
      ),
    ).sort((a, b) => a - b);
    result[staffId] = sanitized;
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
