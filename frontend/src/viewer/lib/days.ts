export function resolveDays(out?: unknown, inJson?: unknown): number {
  const extractLength = (value: unknown): number | null => {
    if (Array.isArray(value)) {
      return value.length;
    }
    return null;
  };

  const readNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return null;
  };

  const extractFromRecord = (value: unknown, key: string): unknown => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  };

  const tryOutMeta = readNumber(extractFromRecord(extractFromRecord(out, 'meta'), 'days'));
  if (tryOutMeta !== null) return tryOutMeta;

  const tryOutDaytypes = extractLength(extractFromRecord(out, 'dayTypeByDate'));
  if (tryOutDaytypes !== null) return tryOutDaytypes;

  const tryInDays = readNumber(extractFromRecord(inJson, 'days'));
  if (tryInDays !== null) return tryInDays;

  const tryInDaytypes = extractLength(extractFromRecord(inJson, 'dayTypeByDate'));
  if (tryInDaytypes !== null) return tryInDaytypes;

  const year = readNumber(extractFromRecord(inJson, 'year'));
  const month = readNumber(extractFromRecord(inJson, 'month'));
  if (year !== null && month !== null) {
    return new Date(year, month, 0).getDate();
  }

  return 31;
}

export function buildDayArray(days: number): number[] {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 0;
  return Array.from({ length: safeDays }, (_, index) => index + 1);
}
