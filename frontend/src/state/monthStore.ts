export type TargetMonth = { year: number; month: number };

const KEY_Y = 'v3shift:targetYear';
const KEY_M = 'v3shift:targetMonth';

const clampMonth = (month: number): number => {
  if (!Number.isFinite(month)) return 1;
  if (month < 1) return 1;
  if (month > 12) return 12;
  return Math.trunc(month);
};

export const normalizeTargetMonth = (year: number, month: number): TargetMonth => {
  const normalizedMonth = clampMonth(month);
  const normalizedYear = Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear();
  return { year: normalizedYear, month: normalizedMonth };
};

export const formatMonthKey = (year: number, month: number): string =>
  `${year}-${String(clampMonth(month)).padStart(2, '0')}`;

export function loadTargetMonth(): TargetMonth {
  const now = new Date();
  if (typeof window === 'undefined') {
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const storage = window.localStorage;
  const storedYear = Number(storage.getItem(KEY_Y));
  const storedMonth = Number(storage.getItem(KEY_M));
  const year = Number.isFinite(storedYear) ? Math.trunc(storedYear) : now.getFullYear();
  const month = Number.isFinite(storedMonth) ? Math.trunc(storedMonth) : now.getMonth() + 1;
  return normalizeTargetMonth(year, month);
}

export function saveTargetMonth(target: TargetMonth): void {
  if (typeof window === 'undefined') return;
  const storage = window.localStorage;
  const normalized = normalizeTargetMonth(target.year, target.month);
  storage.setItem(KEY_Y, String(normalized.year));
  storage.setItem(KEY_M, String(normalized.month));
}
