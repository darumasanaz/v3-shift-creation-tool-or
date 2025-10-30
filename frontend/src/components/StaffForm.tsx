import { ChangeEvent } from 'react';
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
  weeklyMax: undefined,
  monthlyMax: undefined,
  consecMax: 5,
});

type StaffFormProps = {
  people: Person[];
  onChange: (people: Person[]) => void;
};

const getSelectedValues = <T extends string>(event: ChangeEvent<HTMLSelectElement>) =>
  Array.from(event.target.selectedOptions).map((option) => option.value as T);

const parseNumberInput = (value: string): number | undefined => {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

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
              <th className="border border-slate-200 px-4 py-3">週上限</th>
              <th className="border border-slate-200 px-4 py-3">月上限</th>
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
                  <select
                    multiple
                    value={person.canWork}
                    onChange={(event) => updatePerson(index, { canWork: getSelectedValues<ShiftCode>(event) })}
                    className="h-24 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  >
                    {SHIFT_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <select
                    multiple
                    value={person.fixedOffWeekdays}
                    onChange={(event) =>
                      updatePerson(index, { fixedOffWeekdays: getSelectedValues<WeekdayJ>(event) })
                    }
                    className="h-24 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  >
                    {WEEKDAY_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={person.weeklyMax ?? ''}
                    onChange={(event) => updatePerson(index, { weeklyMax: parseNumberInput(event.target.value) })}
                    placeholder="無制限"
                  />
                </td>
                <td className="border border-slate-200 px-4 py-3 align-top">
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={person.monthlyMax ?? ''}
                    onChange={(event) => updatePerson(index, { monthlyMax: parseNumberInput(event.target.value) })}
                    placeholder="無制限"
                  />
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
