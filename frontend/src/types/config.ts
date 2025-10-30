export type ShiftCode = 'EA' | 'DA' | 'DB' | 'LA' | 'NA' | 'NB' | 'NC';
export type WeekdayJ = '月' | '火' | '水' | '木' | '金' | '土' | '日';

export type Person = {
  id: string;
  canWork: ShiftCode[];
  fixedOffWeekdays: WeekdayJ[];
  weeklyMin?: number;
  weeklyMax?: number;
  monthlyMin?: number;
  monthlyMax?: number;
  consecMax?: number;
};

export type WishOffs = {
  [staffId: string]: number[];
};

export type NightRestSetting = {
  NA: number;
  NB: number;
  NC: number;
};

export type Rules = {
  noEarlyAfterDayAB: boolean;
  nightRest: NightRestSetting;
};

export type FormState = {
  people: Person[];
  rules: Rules;
};
