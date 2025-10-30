import rawShiftCatalog from '@solver/shifts_catalog.json';

type RawShift = {
  code?: unknown;
  name?: unknown;
  start?: unknown;
  end?: unknown;
};

export type ShiftDefinition = {
  code: string;
  name: string;
  start: number;
  end: number;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const normalizeShift = (entry: RawShift): ShiftDefinition => {
  const code = typeof entry.code === 'string' && entry.code ? entry.code : null;
  if (!code) {
    throw new Error('Shift catalog entry is missing a valid code.');
  }
  if (!isFiniteNumber(entry.start) || !isFiniteNumber(entry.end)) {
    throw new Error(`Shift catalog entry ${code} is missing start/end hours.`);
  }
  const name = typeof entry.name === 'string' && entry.name ? entry.name : code;
  return { code, name, start: entry.start, end: entry.end };
};

const normalizeCatalog = (input: unknown): ShiftDefinition[] => {
  if (!Array.isArray(input)) {
    throw new Error('Shift catalog must be an array.');
  }
  const normalized = input.map((entry) => normalizeShift(entry as RawShift));
  const seen = new Set<string>();
  for (const { code } of normalized) {
    if (seen.has(code)) {
      throw new Error(`Shift catalog contains duplicate code: ${code}`);
    }
    seen.add(code);
  }
  return normalized;
};

export const SHIFT_CATALOG: ShiftDefinition[] = normalizeCatalog(rawShiftCatalog);
export const SHIFT_CODES = SHIFT_CATALOG.map((shift) => shift.code);
export const SHIFT_CODE_SET = new Set<string>(SHIFT_CODES);
export type ShiftCode = (typeof SHIFT_CODES)[number];

export const SHIFT_SELECT_OPTIONS = SHIFT_CATALOG.map((shift) => ({
  value: shift.code as ShiftCode,
  label: shift.code,
}));
