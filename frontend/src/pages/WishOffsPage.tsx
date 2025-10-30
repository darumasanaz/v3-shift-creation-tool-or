import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { CONFIG_STORAGE_KEY } from '../lib/storageKeys';
import {
  WISH_OFFS_STORAGE_KEY,
  loadWishOffsFromStorage,
  sanitizeWishOffs,
  saveWishOffsToStorage,
} from '../lib/wishOffs';
import { WishOffs } from '../types/config';

const DAYS_IN_MONTH = 31;
const YEAR = 2025;
const MONTH_INDEX = 11; // December

type StaffListItem = {
  id: string;
};

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-indigo-600 text-white shadow' : 'text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900'
  }`;

const downloadJson = (data: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const loadStaffFromStorage = (): StaffListItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { people?: unknown };
    const people = Array.isArray(parsed.people) ? parsed.people : [];
    return people
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const id = (entry as { id?: unknown }).id;
        if (typeof id !== 'string') return null;
        const trimmed = id.trim();
        return trimmed.length > 0 ? { id: trimmed } : null;
      })
      .filter((item): item is StaffListItem => item !== null);
  } catch (error) {
    console.warn('Failed to load staff list from storage', error);
    return [];
  }
};

const buildCalendarCells = () => {
  const firstWeekday = new Date(YEAR, MONTH_INDEX, 1).getDay();
  const totalCells = Math.ceil((firstWeekday + DAYS_IN_MONTH) / 7) * 7;
  return Array.from({ length: totalCells }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= DAYS_IN_MONTH ? day : null;
  });
};

const CALENDAR_CELLS = buildCalendarCells();

export default function WishOffsPage() {
  const [staff, setStaff] = useState<StaffListItem[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [wishOffs, setWishOffs] = useState<WishOffs>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initialWishOffs = loadWishOffsFromStorage();
    setWishOffs(initialWishOffs);

    const staffList = loadStaffFromStorage();
    setStaff(staffList);
    if (staffList.length > 0) {
      setSelectedStaffId(staffList[0].id);
    } else {
      setSelectedStaffId(null);
    }
  }, []);

  const selectedDays = useMemo(() => {
    if (!selectedStaffId) return [];
    const days = wishOffs[selectedStaffId] ?? [];
    return [...days].sort((a, b) => a - b);
  }, [selectedStaffId, wishOffs]);

  const toggleDay = (day: number) => {
    if (!selectedStaffId) return;
    setWishOffs((prev) => {
      const current = prev[selectedStaffId] ?? [];
      const has = current.includes(day);
      const nextDays = has ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b);
      return {
        ...prev,
        [selectedStaffId]: nextDays,
      };
    });
    setStatus(null);
    setError(null);
  };

  const removeDay = (day: number) => {
    if (!selectedStaffId) return;
    setWishOffs((prev) => {
      const current = prev[selectedStaffId] ?? [];
      return {
        ...prev,
        [selectedStaffId]: current.filter((value) => value !== day),
      };
    });
    setStatus(null);
    setError(null);
  };

  const refreshStaff = () => {
    const staffList = loadStaffFromStorage();
    setStaff(staffList);
    setSelectedStaffId((prev) => {
      if (prev && staffList.some((item) => item.id === prev)) {
        return prev;
      }
      return staffList.length > 0 ? staffList[0].id : null;
    });
  };

  const handleSave = () => {
    try {
      const sanitized = sanitizeWishOffs(wishOffs);
      setWishOffs(sanitized);
      saveWishOffsToStorage(sanitized);
      setStatus('ローカルに保存しました');
      setError(null);
    } catch (err) {
      console.warn('Failed to save wish offs', err);
      setStatus(null);
      setError('保存に失敗しました');
    }
  };

  const handleDownload = () => {
    const sanitized = sanitizeWishOffs(wishOffs);
    downloadJson(sanitized, `${WISH_OFFS_STORAGE_KEY}.json`);
    setStatus('JSONをダウンロードしました');
    setError(null);
  };

  const calendarCells = CALENDAR_CELLS;
  const isCalendarDisabled = !selectedStaffId;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">希望休エディタ (2025年12月)</h1>
            <nav className="flex items-center gap-1">
              <NavLink to="/" className={navLinkClass}>
                Viewer
              </NavLink>
              <NavLink to="/config" className={navLinkClass}>
                Config
              </NavLink>
              <NavLink to="/wish-offs" className={navLinkClass}>
                WishOffs
              </NavLink>
            </nav>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshStaff}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              スタッフ再読込
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              保存
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              JSONダウンロード
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        {status && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status">
            {status}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-900">スタッフ</h2>
              <p className="text-xs text-slate-500">Configページで保存されたスタッフ一覧から選択します。</p>
              <select
                value={selectedStaffId ?? ''}
                onChange={(event) => setSelectedStaffId(event.target.value || null)}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {staff.length === 0 && <option value="">スタッフが登録されていません</option>}
                {staff.map(({ id }) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <ul className="space-y-1 text-sm">
                {staff.length === 0 ? (
                  <li className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-slate-500">
                    スタッフ設定を保存すると一覧に表示されます。
                  </li>
                ) : (
                  staff.map(({ id }) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setSelectedStaffId(id)}
                        className={`w-full rounded-md px-3 py-2 text-left transition ${
                          selectedStaffId === id
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {id}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </aside>

          <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">カレンダー</h2>
                <p className="text-sm text-slate-500">日付をクリックして希望休を切り替えます。</p>
              </div>
              <div className="text-sm text-slate-500">{selectedStaffId ? selectedStaffId : 'スタッフ未選択'}</div>
            </div>

            <div className="grid grid-cols-7 gap-2 text-sm">
              {['日', '月', '火', '水', '木', '金', '土'].map((label) => (
                <div key={label} className="text-center font-semibold text-slate-600">
                  {label}
                </div>
              ))}
              {calendarCells.map((day, index) => {
                if (day === null) {
                  return <div key={`empty-${index}`} className="h-12" />;
                }
                const isActive = selectedDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    disabled={isCalendarDisabled}
                    className={`flex h-12 items-center justify-center rounded-md border text-sm font-medium transition ${
                      isActive
                        ? 'border-indigo-400 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                    } ${isCalendarDisabled ? 'cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white' : ''}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">このスタッフの希望休</h3>
              <div className="flex flex-wrap gap-2">
                {selectedDays.length === 0 ? (
                  <span className="text-sm text-slate-400">希望休は登録されていません。</span>
                ) : (
                  selectedDays.map((day) => (
                    <span
                      key={day}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800"
                    >
                      {day}日
                      <button
                        type="button"
                        onClick={() => removeDay(day)}
                        className="rounded-full p-0.5 text-indigo-700 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        aria-label={`${day}日を削除`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
