import { useMemo } from 'react';
import { formatMonthKey } from '../state/monthStore';
import { useTargetMonth } from '../state/MonthContext';

const formatDisplayValue = (year: number, month: number) => formatMonthKey(year, month);

export const MonthPicker = () => {
  const { targetMonth, setTargetMonth } = useTargetMonth();
  const value = useMemo(() => formatDisplayValue(targetMonth.year, targetMonth.month), [targetMonth]);

  const applyShift = (delta: number) => {
    const date = new Date(targetMonth.year, targetMonth.month - 1 + delta, 1);
    setTargetMonth({ year: date.getFullYear(), month: date.getMonth() + 1 });
  };

  const handleChange = (newValue: string) => {
    if (!newValue) return;
    const [y, m] = newValue.split('-').map((part) => Number(part));
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    setTargetMonth({ year: Math.trunc(y), month: Math.trunc(m) });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => applyShift(-1)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 transition hover:bg-slate-50"
        aria-label="前の月を選択"
      >
        ◀
      </button>
      <input
        type="month"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        aria-label="作成月"
      />
      <button
        type="button"
        onClick={() => applyShift(1)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 transition hover:bg-slate-50"
        aria-label="次の月を選択"
      >
        ▶
      </button>
    </div>
  );
};
