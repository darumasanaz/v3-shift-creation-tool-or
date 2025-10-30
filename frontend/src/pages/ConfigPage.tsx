import { FormEvent, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { StaffForm } from '../components/StaffForm';
import { buildSolverInput, deserializePeople, deserializeRules } from '../lib/jsonBuilders';
import { CONFIG_STORAGE_KEY } from '../lib/storageKeys';
import { loadWishOffsFromStorage } from '../lib/wishOffs';
import { FormState, Person, Rules, ShiftCode, WeekdayJ } from '../types/config';
const SAMPLE_PATH = '/sample_input_real.json';

const SHIFT_CODES: ShiftCode[] = ['EA', 'DA', 'DB', 'LA', 'NA', 'NB', 'NC'];
const WEEKDAY_CODES: WeekdayJ[] = ['月', '火', '水', '木', '金', '土', '日'];

const SHIFT_CODE_SET = new Set<string>(SHIFT_CODES);
const WEEKDAY_SET = new Set<string>(WEEKDAY_CODES);

const DEFAULT_RULES: Rules = {
  noEarlyAfterDayAB: false,
  nightRest: { NA: 2, NB: 1, NC: 1 },
};

const createInitialState = (): FormState => ({
  people: [],
  rules: {
    ...DEFAULT_RULES,
    nightRest: { ...DEFAULT_RULES.nightRest },
  },
});

type AnyRecord = Record<string, unknown>;

const sanitizeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

const sanitizeStringArray = <T extends string>(value: unknown, validSet: Set<string>): T[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => typeof item === 'string' && validSet.has(item));
};

const sanitizePerson = (value: unknown): Person => {
  const raw = (value ?? {}) as AnyRecord;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    canWork: sanitizeStringArray<ShiftCode>(raw.canWork, SHIFT_CODE_SET),
    fixedOffWeekdays: sanitizeStringArray<WeekdayJ>(raw.fixedOffWeekdays, WEEKDAY_SET),
    weeklyMin: sanitizeNumber(raw.weeklyMin) ?? 0,
    weeklyMax: sanitizeNumber(raw.weeklyMax) ?? 0,
    monthlyMin: sanitizeNumber(raw.monthlyMin) ?? 0,
    monthlyMax: sanitizeNumber(raw.monthlyMax) ?? 0,
    consecMax: sanitizeNumber(raw.consecMax),
  };
};

const sanitizeFormState = (value: unknown): FormState => {
  const raw = (value ?? {}) as AnyRecord;
  const peopleSource = Array.isArray(raw.people) ? raw.people : [];
  const rulesSource = (raw.rules ?? {}) as Rules;
  return {
    people: peopleSource.map(sanitizePerson),
    rules: deserializeRules(rulesSource, DEFAULT_RULES),
  };
};

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-600 text-white shadow'
      : 'text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900'
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

const parseNumberInput = (value: string): number => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export default function ConfigPage() {
  const [formState, setFormState] = useState<FormState>(createInitialState);
  const [template, setTemplate] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  useEffect(() => {
    const fromStorage = () => {
      if (typeof window === 'undefined') return;
      try {
        const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        setFormState(sanitizeFormState(parsed));
        setStatus('ローカル保存データを読み込みました');
        setError(null);
      } catch (err) {
        console.warn('failed to load local storage', err);
        setStatus(null);
        setError('保存済みデータの読み込みに失敗しました');
      }
    };
    fromStorage();
  }, []);

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const res = await fetch(SAMPLE_PATH, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as Record<string, unknown>;
        setTemplate(json);
      } catch (err) {
        console.error(err);
        setStatus(null);
        setError('サンプルJSONの取得に失敗しました');
      }
    };
    loadTemplate();
  }, []);

  const onPeopleChange = (people: Person[]) => {
    setFormState((prev) => ({
      ...prev,
      people,
    }));
  };

  const onRulesChange = (changes: Partial<Rules>) => {
    setFormState((prev) => ({
      ...prev,
      rules: {
        ...prev.rules,
        ...changes,
        nightRest: {
          ...prev.rules.nightRest,
          ...(changes.nightRest ?? {}),
        },
      },
    }));
  };

  const handleSave = () => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(formState));
      setStatus('ローカルに保存しました');
      setError(null);
    } catch (err) {
      console.error(err);
      setStatus(null);
      setError('保存に失敗しました');
    }
  };

  const handleLoad = () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
      if (!raw) {
        setStatus('保存されたデータはありません');
        setError(null);
        return;
      }
      setFormState(sanitizeFormState(JSON.parse(raw)));
      setStatus('保存データを読み込みました');
      setError(null);
    } catch (err) {
      console.error(err);
      setStatus(null);
      setError('保存データの読み込みに失敗しました');
    }
  };

  const handleSampleLoad = async () => {
    setIsLoadingSample(true);
    try {
      const res = await fetch(SAMPLE_PATH, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as Record<string, unknown>;
      const peopleRaw = Array.isArray((json as AnyRecord).people)
        ? ((json as AnyRecord).people as unknown[])
        : [];
      const samplePeople = deserializePeople(peopleRaw as any);
      const sampleRules = deserializeRules(((json as AnyRecord).rules ?? undefined) as unknown, DEFAULT_RULES);
      setTemplate(json);
      setFormState({ people: samplePeople, rules: sampleRules });
      setStatus('サンプルデータを読み込みました');
      setError(null);
    } catch (err) {
      console.error(err);
      setStatus(null);
      setError('サンプルデータの読み込みに失敗しました');
    } finally {
      setIsLoadingSample(false);
    }
  };

  const handleDownload = (event: FormEvent) => {
    event.preventDefault();
    if (!template) {
      setStatus(null);
      setError('サンプルテンプレートの取得を待っています');
      return;
    }
    const wishOffs = loadWishOffsFromStorage();
    const json = buildSolverInput(template, formState, { wishOffs });
    downloadJson(json, 'input.json');
    setStatus('input.json をダウンロードしました');
    setError(null);
  };

  const duplicateIdCount = useMemo(() => {
    const ids = formState.people.map((person) => person.id.trim()).filter(Boolean);
    return ids.filter((id, index) => ids.indexOf(id) !== index).length;
  }, [formState.people]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">シフト条件エディタ</h1>
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
              onClick={handleSave}
              className="rounded-md border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              保存
            </button>
            <button
              type="button"
              onClick={handleLoad}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              読み込み
            </button>
            <button
              type="button"
              onClick={handleSampleLoad}
              disabled={isLoadingSample}
              className="rounded-md border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoadingSample ? '読込中…' : 'サンプル読込'}
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

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">スタッフ設定</h2>
              <p className="text-sm text-slate-500">勤務可能シフト・固定休・上限などを入力します。</p>
            </div>
            <div className="text-sm text-slate-500">
              登録スタッフ: {formState.people.length} 名 / 重複ID: {duplicateIdCount} 件
            </div>
          </div>
          <StaffForm people={formState.people} onChange={onPeopleChange} />
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">ルール設定</h2>
            <p className="text-sm text-slate-500">夜勤後の休息など、solver へ渡す制約を設定します。</p>
          </div>
          <div className="space-y-4">
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={formState.rules.noEarlyAfterDayAB}
                onChange={(event) => onRulesChange({ noEarlyAfterDayAB: event.target.checked })}
                className="h-4 w-4 rounded border border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Day/AB の翌日に早番 (EA) を禁止する</span>
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              {(['NA', 'NB', 'NC'] as const).map((code) => (
                <label key={code} className="flex flex-col gap-2 text-sm text-slate-700">
                  <span className="font-medium">{code} 明けの休息日数</span>
                  <input
                    type="number"
                    min={0}
                    value={formState.rules.nightRest[code] ?? 0}
                    onChange={(event) =>
                      onRulesChange({
                        nightRest: {
                          ...formState.rules.nightRest,
                          [code]: parseNumberInput(event.target.value),
                        },
                      })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-slate-500">
          <h2 className="text-lg font-semibold text-slate-900">需要テンプレ・その他</h2>
          <p className="text-sm">
            日別の需要テンプレートや追加ルールは将来バージョンで編集できるようにする予定です。現状はサンプル設定をそのまま利用します。
          </p>
        </section>

        <form onSubmit={handleDownload} className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            disabled={!template}
          >
            JSONダウンロード
          </button>
        </form>
      </main>
    </div>
  );
}
