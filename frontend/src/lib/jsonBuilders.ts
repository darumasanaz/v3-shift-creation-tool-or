import { FormState, Person, Rules, ShiftCode, WeekdayJ } from '../types/config';

type SolverPerson = Person & {
  weeklyMax: number;
  monthlyMax: number;
  consecMax: number;
};

type SolverInput = {
  people: SolverPerson[];
  rules: Rules;
  [key: string]: unknown;
};

type MaybeRules = Partial<Rules> & {
  nightRest?: Partial<Rules['nightRest']>;
};

const ensureNumber = (value: number | undefined, fallback = 0): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return value;
};

const normalizePerson = (person: Person): SolverPerson => ({
  ...person,
  weeklyMax: ensureNumber(person.weeklyMax),
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

export const buildSolverInput = (base: Record<string, unknown>, form: FormState): SolverInput => {
  const { rules: _baseRules, people: _basePeople, ...rest } = base as SolverInput;
  return {
    ...rest,
    people: form.people.map(normalizePerson),
    rules: normalizeRules(form.rules),
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
      weeklyMax: raw.weeklyMax || undefined,
      monthlyMax: raw.monthlyMax || undefined,
      consecMax: raw.consecMax || undefined,
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
