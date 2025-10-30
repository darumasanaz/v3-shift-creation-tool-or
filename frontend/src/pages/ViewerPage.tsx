import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LAST_OUTPUT_STORAGE_KEY,
  LAST_OUTPUT_UPDATED_AT_KEY,
} from '../lib/storageKeys';
import { requestSolve, SolveError } from '../lib/solveClient';

type ShiftCode = string;

type MatrixEntry = {
  date: number | string;
  shifts: Record<string, ShiftCode>;
};

type SummaryTotals = {
  shortage?: number;
  excess?: number;
  violatedPreferences?: number;
  [key: string]: number | undefined;
};

type Summary = {
  totals?: SummaryTotals;
};

type ScheduleData = {
  peopleOrder: string[];
  matrix: MatrixEntry[];
  summary?: Summary;
};

const NIGHT_SHIFT_CODES = new Set(['NA', 'NB', 'NC']);

type SummaryCard = {
  key: keyof SummaryTotals;
  label: string;
};

const SUMMARY_CARDS: SummaryCard[] = [
  { key: 'shortage', label: '不足' },
  { key: 'excess', label: '過剰' },
  { key: 'wishOffViolations', label: '希望休違反' },
];

type OutputDetection = {
  kind: 'output';
  matched: string[];
  missing: string[];
};

type InputDetection = {
  kind: 'input';
  matched: string[];
  missing: string[];
  forbidden: string[];
  absentOutputKeys: string[];
};

type UnknownDetection = {
  kind: 'unknown';
  output: { matched: string[]; missing: string[] };
  input: { matched: string[]; missing: string[] };
};

type DetectionResult = OutputDetection | InputDetection | UnknownDetection;

const OUTPUT_REQUIRED_KEYS: Record<string, (value: unknown) => boolean> = {
  peopleOrder: Array.isArray,
  matrix: Array.isArray,
};

const INPUT_REQUIRED_KEYS: Record<string, (value: unknown) => boolean> = {
  people: Array.isArray,
  shifts: Array.isArray,
};

const INPUT_FORBIDDEN_KEYS = ['assignments', 'matrix', 'peopleOrder'];
const OUTPUT_KEY_HINTS = ['assignments'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function analyseKeys(
  record: Record<string, unknown>,
  schema: Record<string, (value: unknown) => boolean>,
): { matched: string[]; missing: string[] } {
  const matched: string[] = [];
  const missing: string[] = [];
  Object.entries(schema).forEach(([key, validator]) => {
    if (validator(record[key])) {
      matched.push(key);
    } else {
      missing.push(key);
    }
  });
  return { matched, missing };
}

function detectScheduleJson(value: unknown): DetectionResult {
  if (!isRecord(value)) {
    return {
      kind: 'unknown',
      output: { matched: [], missing: Object.keys(OUTPUT_REQUIRED_KEYS) },
      input: { matched: [], missing: Object.keys(INPUT_REQUIRED_KEYS) },
    };
  }

  const outputCheck = analyseKeys(value, OUTPUT_REQUIRED_KEYS);
  if (outputCheck.missing.length === 0) {
    return { kind: 'output', ...outputCheck };
  }

  const inputCheck = analyseKeys(value, INPUT_REQUIRED_KEYS);
  const forbidden = INPUT_FORBIDDEN_KEYS.filter((key) => key in value);
  if (inputCheck.missing.length === 0 && forbidden.length === 0) {
    const absentOutputKeys = OUTPUT_KEY_HINTS.filter((key) => !(key in value));
    return {
      kind: 'input',
      ...inputCheck,
      forbidden,
      absentOutputKeys,
    };
  }

  return {
    kind: 'unknown',
    output: outputCheck,
    input: inputCheck,
  };
}

function formatDate(value: MatrixEntry['date']): string {
  if (typeof value === 'number') {
    // Interpret large timestamps as dates and smaller numbers as ordinal days.
    if (value > 10_000_000) {
      return new Date(value).toLocaleDateString('ja-JP');
    }
    return `${value}`;
  }
  return value;
}

function buildCsv(data: ScheduleData): string {
  const headers = ['日付', ...data.peopleOrder];
  const escapeCell = (cell: string | number): string => {
    const raw = `${cell ?? ''}`;
    const escaped = raw.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const lines = data.matrix.map((entry) => {
    const dateValue = formatDate(entry.date);
    const cells = data.peopleOrder.map((person) => entry.shifts[person] ?? '');
    return [dateValue, ...cells].map(escapeCell).join(',');
  });

  return [headers.map(escapeCell).join(','), ...lines].join('\n');
}

function downloadCsv(data: ScheduleData) {
  const csv = buildCsv(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shift-schedule.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-600 text-white shadow'
      : 'text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900'
  }`;

export default function ViewerPage() {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSolving, setIsSolving] = useState(false);
  const [pendingInput, setPendingInput] = useState<Record<string, unknown> | null>(null);
  const [inputAnalysis, setInputAnalysis] = useState<InputDetection | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LAST_OUTPUT_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as unknown;
      const detection = detectScheduleJson(parsed);
      if (detection.kind !== 'output') {
        return;
      }

      setSchedule(parsed as ScheduleData);
      setError(null);
      setNotice(null);
      setPendingInput(null);
      setInputAnalysis(null);

      const updatedAtRaw = window.localStorage.getItem(LAST_OUTPUT_UPDATED_AT_KEY);
      let timestamp = '';
      if (updatedAtRaw) {
        const parsedDate = new Date(updatedAtRaw);
        if (!Number.isNaN(parsedDate.getTime())) {
          timestamp = parsedDate.toLocaleTimeString('ja-JP', { hour12: false });
        }
      }
      if (!timestamp) {
        timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
      }

      setAutoMessage(`Configからの実行結果を表示しています（最終更新: ${timestamp}）`);
    } catch (storageError) {
      console.error('failed to load last output from storage', storageError);
    }
  }, []);

  const formatKeyList = (keys: string[]): string => keys.join('、');

  const buildInputSummary = (analysis: InputDetection) => {
    const parts: string[] = [];
    if (analysis.matched.length > 0) {
      parts.push(`${formatKeyList(analysis.matched)} があり`);
    }
    if (analysis.absentOutputKeys.length > 0) {
      parts.push(`${formatKeyList(analysis.absentOutputKeys)} がありません`);
    }
    if (analysis.forbidden.length > 0) {
      parts.push(`${formatKeyList(analysis.forbidden)} が含まれていません`);
    }
    const reason = parts.length > 0 ? parts.join('、') : '入力用のキー構成です。';
    return `入力JSONと判定しました（判定根拠: ${reason}）。`;
  };

  const buildInputGuidance = (analysis: InputDetection) =>
    [
      'このファイルは solver の入力JSONのようです。Viewer は出力JSON（output.json）を表示します。',
      '開発モードでは「この入力で実行」ボタンで solver を実行し、結果を表示できます。',
      buildInputSummary(analysis),
    ].join('\n');

  const buildUnknownMessage = (analysis: UnknownDetection) => {
    const lines = ['JSONの形式を判定できませんでした。'];
    if (analysis.output.missing.length > 0) {
      lines.push(`出力JSONに必要なキー: ${formatKeyList(analysis.output.missing)} が見つかりません。`);
    }
    if (analysis.input.missing.length > 0) {
      lines.push(`入力JSONに必要なキー: ${formatKeyList(analysis.input.missing)} が見つかりません。`);
    }
    if (analysis.output.matched.length > 0) {
      lines.push(`出力JSONの候補キー: ${formatKeyList(analysis.output.matched)} は見つかりました。`);
    }
    if (analysis.input.matched.length > 0) {
      lines.push(`入力JSONの候補キー: ${formatKeyList(analysis.input.matched)} は見つかりました。`);
    }
    return lines.join('\n');
  };

  const runSolver = async (input: Record<string, unknown>, analysis: InputDetection) => {
    setIsSolving(true);
    setError(null);
    setNotice(`${buildInputSummary(analysis)} solverを実行しています…`);
    try {
      const solved = await requestSolve(input);
      const detection = detectScheduleJson(solved);
      if (detection.kind !== 'output') {
        throw new Error('Solver result did not match the expected output schema.');
      }
      setSchedule(solved as ScheduleData);
      setError(null);
      setNotice(`${buildInputSummary(analysis)} solverの実行が完了しました。`);
      setAutoMessage(null);
    } catch (solverError) {
      if (solverError instanceof SolveError) {
        console.error('solver execution failed', { status: solverError.status, body: solverError.body });
      } else {
        console.error(solverError);
      }
      setSchedule(null);
      setError('solverの実行に失敗しました。開発サーバーのログを確認してください。');
      setNotice(buildInputSummary(analysis));
      setAutoMessage(null);
    } finally {
      setIsSolving(false);
    }
  };

  const loadSample = async () => {
    try {
      const res = await fetch('/output.json', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ScheduleData;
      if (!Array.isArray(json.peopleOrder) || !Array.isArray(json.matrix)) {
        throw new Error('Invalid schema');
      }
      setSchedule(json);
      setError(null);
      setNotice(null);
      setPendingInput(null);
      setInputAnalysis(null);
      setAutoMessage(null);
      alert('読み込み完了');
    } catch (e) {
      console.error(e);
      alert('output.json が見つかりません。READMEの「サンプル読込の準備」を参照してください。');
    }
  };

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        if (typeof text !== 'string') {
          throw new Error('ファイルを読み込めませんでした');
        }
        const parsed = JSON.parse(text) as unknown;
        const detection = detectScheduleJson(parsed);
        if (detection.kind === 'output') {
          setSchedule(parsed as ScheduleData);
          setError(null);
          setNotice(null);
          setPendingInput(null);
          setInputAnalysis(null);
          setAutoMessage(null);
        } else if (detection.kind === 'input') {
          setSchedule(null);
          setPendingInput(parsed as Record<string, unknown>);
          setInputAnalysis(detection);
          if (import.meta.env.DEV) {
            void runSolver(parsed as Record<string, unknown>, detection);
          } else {
            setError(buildInputGuidance(detection));
            setNotice(null);
          }
          setAutoMessage(null);
        } else {
          setSchedule(null);
          setError(buildUnknownMessage(detection));
          setNotice(null);
          setPendingInput(null);
          setInputAnalysis(null);
          setAutoMessage(null);
        }
      } catch (e) {
        console.error(e);
        setSchedule(null);
        setError('JSONの解析に失敗しました。ファイル形式やエンコーディングを確認してください。詳細はコンソールを参照してください。');
        setNotice(null);
        setPendingInput(null);
        setInputAnalysis(null);
        setAutoMessage(null);
      }
    };
    reader.onerror = () => {
      setError('ファイルの読み込み中にエラーが発生しました。');
      setSchedule(null);
      setNotice(null);
      setPendingInput(null);
      setInputAnalysis(null);
      setAutoMessage(null);
    };
    reader.readAsText(file, 'utf-8');
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    handleFile(file ?? null);
    // Reset the input so the same file can be selected twice in a row.
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    handleFile(file ?? null);
  };

  const totals = schedule?.summary?.totals ?? {};
  const summaryValues = useMemo(
    () =>
      SUMMARY_CARDS.map(({ key, label }) => ({
        key,
        label,
        value: totals[key] ?? 0,
      })),
    [totals],
  );

  const nightShiftClass = (shift: ShiftCode) =>
    NIGHT_SHIFT_CODES.has(shift)
      ? 'bg-indigo-50 text-indigo-900'
      : '';

  const scheduleView = useMemo(() => {
    if (!schedule) return null;

    const dates = schedule.matrix.map((entry, index) => {
      const label = formatDate(entry.date);
      return {
        label,
        key: `${label}-${index}`,
      };
    });

    const rows = schedule.peopleOrder.map((person) => ({
      person,
      shifts: schedule.matrix.map((entry) => entry.shifts[person] ?? ''),
    }));

    return { dates, rows };
  }, [schedule]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">出力JSONビューア</h1>
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
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={onFileChange}
            />
            <button
              type="button"
              onClick={loadSample}
              className="rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              サンプル読込
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              JSONを読み込み
            </button>
            <button
              type="button"
              onClick={() => schedule && downloadCsv(schedule)}
              disabled={!schedule}
              className="rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              CSVダウンロード
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        {autoMessage && (
          <div
            className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            role="status"
          >
            {autoMessage}
          </div>
        )}
        <section
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-indigo-300 bg-white p-8 text-center transition ${
            isDragging ? 'border-indigo-500 bg-indigo-50' : ''
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => {
            setIsDragging(false);
          }}
          onDrop={onDrop}
          role="region"
          aria-label="JSONファイルのドラッグアンドドロップ領域"
          tabIndex={0}
        >
          <p className="text-lg font-medium text-slate-800">ここに JSON ファイルをドロップ</p>
          <p className="text-sm text-slate-500">output.json はそのまま表示され、input.json は開発モードで solver を実行できます</p>
        </section>

        {notice && (
          <div
            className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800"
            role="status"
          >
            {notice}
          </div>
        )}

        {error && (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-line"
            role="alert"
          >
            {error}
          </div>
        )}

        {import.meta.env.DEV && pendingInput && inputAnalysis && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => pendingInput && inputAnalysis && void runSolver(pendingInput, inputAnalysis)}
              disabled={isSolving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSolving ? 'solver 実行中…' : 'この入力で実行'}
            </button>
            <p className="text-sm text-slate-500">
              Python solver を呼び出して output.json 相当の結果を表示します。
            </p>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3" aria-label="サマリー">
          {summaryValues.map(({ key, label, value }) => (
            <div
              key={key}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
            </div>
          ))}
        </section>

        {scheduleView ? (
          <section
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
            aria-label="シフト表"
          >
            <table className="min-w-full border-collapse">
              <caption className="sr-only">シフトスケジュール</caption>
              <thead className="bg-slate-100">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700"
                  >
                    スタッフ
                  </th>
                  {scheduleView.dates.map(({ key, label }) => (
                    <th
                      key={key}
                      scope="col"
                      className="sticky top-0 z-10 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleView.rows.map(({ person, shifts }) => (
                  <tr key={person} className="odd:bg-white even:bg-slate-50">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-slate-200 bg-inherit px-4 py-3 text-left text-sm font-bold text-slate-700"
                    >
                      {person}
                    </th>
                    {shifts.map((shift, index) => {
                      const { key } = scheduleView.dates[index];
                      return (
                        <td
                          key={`${person}-${key}`}
                          className={`border-r border-slate-200 px-4 py-3 text-sm font-medium text-slate-800 ${nightShiftClass(shift)}`}
                        >
                          {shift || '休'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <p className="text-sm text-slate-500">output.json を読み込むとシフト表が表示されます。</p>
        )}
      </main>
    </div>
  );
}
