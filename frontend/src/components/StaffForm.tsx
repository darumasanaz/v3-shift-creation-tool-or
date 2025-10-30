import { Person, ShiftCode, WeekdayJ } from '../types/config';

const SHIFT_OPTIONS: { value: ShiftCode; label: string }[] = [
  { value: 'EA', label: 'EA' },
  { value: 'DA', label: 'DA' },
  { value: 'DB', label: 'DB' },
  { value: 'LA', label: 'LA' },
  { value: 'NA', label: 'NA' },
  { value: 'NB', label: 'NB' },
  { value: 'NC', label: 'NC' },
];

const WEEKDAY_OPTIONS: { value: WeekdayJ; label: string }[] = [
  { value: '月', label: '月' },
  { value: '火', label: '火' },
  { value: '水', label: '水' },
  { value: '木', label: '木' },
  { value: '金', label: '金' },
  { value: '土', label: '土' },
  { value: '日', label: '日' },
];

const newPerson = (): Person => ({
  id: '',
  canWork: [],
  fixedOffWeekdays: [],
  weeklyMin: 0,
  weeklyMax: 0,
  monthlyMin: 0,
  monthlyMax: 0,
  consecMax: 5,
});

type StaffFormProps = {
  people: Person[];
  onChange: (people: Person[]) => void;
};

const parseNumberInput = (value: string): number | undefined => {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseNumberOrZero = (value: string): number => {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

type MultiSelectOption<T extends string> = {
  value: T;
  label: string;
};

type MultiSelectChipsProps<T extends string> = {
  options: MultiSelectOption<T>[];
  selected: T[];
  onChange: (values: T[]) => void;
  name: string;
};

function MultiSelectChips<T extends string>({ options, selected, onChange, name }: MultiSelectChipsProps<T>) {
  const orderIndex = new Map(options.map((option, index) => [option.value, index] as const));

  const sortedSelected = [...selected].sort(
    (a, b) => (orderIndex.get(a) ?? Number.POSITIVE_INFINITY) - (orderIndex.get(b) ?? Number.POSITIVE_INFINITY),
  );

  const toggleValue = (value: T) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }
    const next = [...selected, value];
    next.sort(
      (a, b) => (orderIndex.get(a) ?? Number.POSITIVE_INFINITY) - (orderIndex.get(b) ?? Number.POSITIVE_INFINITY),
    );
    onChange(next);
  };

  const optionLabel = (value: T) => options.find((option) => option.value === value)?.label ?? value;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {sortedSelected.length === 0 ? (
          <span className="text-xs text-slate-400">未選択</span>
        ) : (
          sortedSelected.map((value) => {
            const label = optionLabel(value);
            return (
              <span
                key={value}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800"
              >
                {label}
                <button
                  type="button"
                  onClick={() => toggleValue(value)}
                  className="rounded-full p-0.5 text-indigo-700 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label={`${label} を削除`}
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {options.map(({ value, label }) => {
          const id = `${name}-${value}`;
          return (
            <label key={value} htmlFor={id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1">
              <input
                id={id}
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => toggleValue(value)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function StaffForm({ people, onChange }: StaffFormProps) {
  const updatePerson = (index: number, changes: Partial<Person>) => {
    const next = people.map((person, idx) =>
      idx === index
        ? {
            ...person,
            ...changes,
          }
        : person,
    );
    onChange(next);
  };

  const duplicateIds = people
    .map((person) => person.id.trim())
    .filter((id, index, array) => id && array.indexOf(id) !== index);

  const peopleWithEmptyShifts = people.filter((person) => person.canWork.length === 0);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed border-separate border-spacing-0">
          <thead>
            <tr className="bg-slate-100 text-left text-sm font-semibold text-slate-700">
              <th className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-4 py-3">名前 (ID)</th>
              <th className="border border-slate-200 px-4 py-3">勤務可シフト</th>
              <th className="border border-slate-200 px-4 py-3">固定休</th>
              <th className="border border-slate-200 px-4 py-3">週 下限 / 上限</th>
              <th className="border border-slate-200 px-4 py-3">月 下限 / 上限</th>
              <th className="border border-slate-200 px-4 py-3">最大連勤</th>
              <th className="w-24 border border-slate-200 px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, index) => (
              <tr key={index} className="odd:bg-white even:bg-slate-50">
                <td className="sticky left-0 z-0 border border-slate-200 bg-inherit px-4 py-3 align-top">
                  <input
                    type="text"
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={person.id}
                    onChange={(event) => updatePerson(index, { id: event.target.value })}
                    placeholder="名前を入力"
                  />
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <MultiSelectChips<ShiftCode>
                    options={SHIFT_OPTIONS}
                    selected={person.canWork}
                    onChange={(values) => updatePerson(index, { canWork: values })}
                    name={`canWork-${index}`}
                  />
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <MultiSelectChips<WeekdayJ>
                    options={WEEKDAY_OPTIONS}
                    selected={person.fixedOffWeekdays}
                    onChange={(values) => updatePerson(index, { fixedOffWeekdays: values })}
                    name={`fixedOff-${index}`}
                  />
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      value={person.weeklyMin ?? 0}
                      onChange={(event) => updatePerson(index, { weeklyMin: parseNumberOrZero(event.target.value) })}
                      placeholder="下限..."
                      aria-label="週の下限"
                    />
                    <span className="text-xs text-slate-400">/</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      value={person.weeklyMax ?? 0}
                      onChange={(event) => updatePerson(index, { weeklyMax: parseNumberOrZero(event.target.value) })}
                      placeholder="上限..."
                      aria-label="週の上限"
                    />
                  </div>
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      value={person.monthlyMin ?? 0}
                      onChange={(event) => updatePerson(index, { monthlyMin: parseNumberOrZero(event.target.value) })}
                      placeholder="下限..."
                      aria-label="月の下限"
                    />
                    <span className="text-xs text-slate-400">/</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      value={person.monthlyMax ?? 0}
                      onChange={(event) => updatePerson(index, { monthlyMax: parseNumberOrZero(event.target.value) })}
                      placeholder="上限..."
                      aria-label="月の上限"
                    />
                  </div>
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={person.consecMax ?? ''}
                    onChange={(event) => updatePerson(index, { consecMax: parseNumberInput(event.target.value) })}
                  />
                </td>
                <td className="border border-slate-200 px-4 py-3 text-center align-top">
                  <button
                    type="button"
                    onClick={() => onChange(people.filter((_, idx) => idx !== index))}
                    className="rounded-md border border-rose-200 px-3 py-1 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onChange([...people, newPerson()])}
          className="rounded-md border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
        >
          行を追加
        </button>
        {duplicateIds.length > 0 && (
          <p className="text-sm text-amber-600">IDが重複しています: {Array.from(new Set(duplicateIds)).join(', ')}</p>
        )}
        {peopleWithEmptyShifts.length > 0 && (
          <p className="text-sm text-amber-600">
            勤務可シフトが未選択のスタッフがあります ({peopleWithEmptyShifts.length}人)
          </p>
        )}
      </div>
    </div>
  );
}
