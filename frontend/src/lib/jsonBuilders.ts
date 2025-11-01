import { SHIFT_CATALOG, ShiftCode } from '../constants/shifts';
import { FormState, Person, Rules, WeekdayJ, WishOffCalendar, WishOffs } from '../types/config';
import { sanitizeWishOffs } from './wishOffs';
import { calcMonthMeta } from './calendar';
import { loadTargetMonth, formatMonthKey } from '../state/monthStore';

type SolverPerson = Person & {
  weeklyMin: number;
  weeklyMax: number;
  monthlyMin: number;
  monthlyMax: number;
  consecMax: number;
};

type SolverInput = {
  people: SolverPerson[];
  rules: Rules;
  wishOffs?: WishOffCalendar;
  weights?: Record<string, unknown>;
  [key: string]: unknown;
};

type MaybeRules = Partial<Rules> & {
  nightRest?: Partial<Rules['nightRest']>;
};

type BuildOptions = {
  wishOffs?: WishOffs;
};

const ensureNumber = (value: number | undefined, fallback = 0): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return value;
};

const normalizePerson = (person: Person): SolverPerson => ({
  ...person,
  weeklyMin: ensureNumber(person.weeklyMin),
  weeklyMax: ensureNumber(person.weeklyMax),
  monthlyMin: ensureNumber(person.monthlyMin),
  monthlyMax: ensureNumber(person.monthlyMax),
  consecMax: ensureNumber(person.consecMax),
});

const normalizeRules = (rules: Rules): Rules => ({
  noEarlyAfterDayAB: rules.noEarlyAfterDayAB,
  nightRest: {
    NA: rules.nightRest.NA,
    NB: rules.nightRest.NB,
    NC: rules.nightRest.NC,
  },
});

export const buildSolverInput = (
  base: Record<string, unknown>,
  form: FormState,
  options: BuildOptions = {},
): SolverInput => {
  const {
    rules: _baseRules,
    people: _basePeople,
    wishOffs: baseWishOffs,
    weights: baseWeights,
    year: baseYearRaw,
    month: baseMonthRaw,
    ...rest
  } = base as SolverInput & { year?: unknown; month?: unknown };

  const baseYear = typeof baseYearRaw === 'number' ? baseYearRaw : undefined;
  const baseMonth = typeof baseMonthRaw === 'number' ? baseMonthRaw : undefined;
  const legacyMonthKey =
    baseYear !== undefined && baseMonth !== undefined ? formatMonthKey(baseYear, baseMonth) : undefined;

  const mergedWishOffs = sanitizeWishOffs(
    {
      ...(typeof baseWishOffs === 'object' && baseWishOffs !== null ? baseWishOffs : {}),
      ...(options.wishOffs ?? {}),
    },
    legacyMonthKey,
  );

  const target = loadTargetMonth();
  const monthMeta = calcMonthMeta(target.year, target.month);
  const monthKey = formatMonthKey(target.year, target.month);
  const monthWishOffs = mergedWishOffs[monthKey] ?? {};

  const weights: Record<string, unknown> = {
    ...(typeof baseWeights === 'object' && baseWeights !== null ? baseWeights : {}),
  };

  if (weights.w_wish_off_violation === undefined && weights.W_requested_off_violation === undefined) {
    weights.w_wish_off_violation = 20;
  }

  return {
    ...rest,
    year: target.year,
    month: target.month,
    days: monthMeta.days,
    weekdayOfDay1: monthMeta.weekdayOfDay1,
    dayTypeByDate: monthMeta.dayTypeByDate,
    shifts: SHIFT_CATALOG.map((shift) => ({ ...shift })),
    people: form.people.map(normalizePerson),
    rules: normalizeRules(form.rules),
    weights,
    wishOffs: monthWishOffs,
  };
};

export const deserializePeople = (people: unknown[]): Person[] =>
  people.map((person) => {
    const raw = person as Partial<SolverPerson>;
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      canWork: Array.isArray(raw.canWork) ? (raw.canWork as ShiftCode[]) : [],
      fixedOffWeekdays: Array.isArray(raw.fixedOffWeekdays)
        ? (raw.fixedOffWeekdays as WeekdayJ[])
        : [],
      weeklyMin: raw.weeklyMin ?? undefined,
      weeklyMax: raw.weeklyMax ?? undefined,
      monthlyMin: raw.monthlyMin ?? undefined,
      monthlyMax: raw.monthlyMax ?? undefined,
      consecMax: raw.consecMax ?? undefined,
    };
  });

export const deserializeRules = (rules: MaybeRules | undefined, defaults: Rules): Rules => ({
  noEarlyAfterDayAB:
    typeof rules?.noEarlyAfterDayAB === 'boolean'
      ? rules.noEarlyAfterDayAB
      : defaults.noEarlyAfterDayAB,
  nightRest: {
    NA: rules?.nightRest?.NA ?? defaults.nightRest.NA,
    NB: rules?.nightRest?.NB ?? defaults.nightRest.NB,
    NC: rules?.nightRest?.NC ?? defaults.nightRest.NC,
  },
});
