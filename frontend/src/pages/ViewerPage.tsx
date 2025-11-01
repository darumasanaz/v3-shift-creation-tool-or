import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LAST_OUTPUT_STORAGE_KEY,
  LAST_OUTPUT_UPDATED_AT_KEY,
} from '../lib/storageKeys';
import { requestSolve, SolveError, isSolveAvailable } from '../lib/solveClient';
import { requestScheduleXlsx } from '../lib/exportClient';
import { evaluateSolverOutputStatus } from '../lib/solverStatus';

type ShiftCode = string;

type MatrixEntry = {
  date: number | string;
  shifts: Record<string, ShiftCode>;
};

type SummaryTotals = {
  shortage?: number;
  excess?: number;
  violatedPreferences?: number;
  assigned?: number;
  [key: string]: number | undefined;
};

const AVAILABILITY_WARNING_MESSAGE = '需要があるのに割り当て可能なスタッフが0人のスロットがあります。';
const INCONSISTENT_SUMMARY_MESSAGE = '需要があるのに不足=0です。コード不一致や可用性ゼロを確認してください。';

type DemandDiagnosticsDay = {
  date?: number;
  total?: number;
  slots?: Record<string, number>;
  carryApplied?: boolean;
};

type DemandDiagnostics = {
  days?: number;
  weekdayOfDay1?: number;
  dayTypeSample?: string[];
  perDayTotals?: DemandDiagnosticsDay[];
  totalNeed?: number;
  warnings?: string[];
  [key: string]: unknown;
};

type SummaryDiagnostics = {
  demand?: DemandDiagnostics;
  [key: string]: unknown;
};

type Summary = {
  totals?: SummaryTotals;
  diagnostics?: SummaryDiagnostics;
};

type SolverErrorInfo = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

type AvailabilitySlots = Record<string, number>;
type AvailabilityMap = Record<string, AvailabilitySlots>;

type AvailabilityWarningEntry = {
  date?: number;
  slot?: string;
  need?: number;
  available?: number;
};

type SolverDiagnostics = {
  availability?: AvailabilityMap;
  availabilityWarnings?: AvailabilityWarningEntry[];
  warnings?: string[];
  flags?: Record<string, unknown>;
  var_counts?: Record<string, number>;
  logOutput?: string;
  [key: string]: unknown;
};

type AssignmentEntry = {
  date?: number;
  staffId?: string;
  shift?: string;
};

type ScheduleData = {
  peopleOrder: string[];
  matrix: MatrixEntry[];
  summary?: Summary;
  error?: SolverErrorInfo | null;
  diagnostics?: SolverDiagnostics;
  assignments?: AssignmentEntry[];
  infeasible?: boolean;
  reason?: string | null;
};

type SampleOption = {
  label: string;
  path: string;
};

const SAMPLE_OUTPUT_OPTIONS: SampleOption[] = [
  { label: 'output.json（ローカルファイル）', path: '/output.json' },
  {
    label: '2025年12月（現場データ・日本語表記）',
    path: '/samples/output_dec2025.json',
  },
];

const NIGHT_SHIFT_CODES = new Set(['NA', 'NB', 'NC']);
const NIGHT_SHIFT_NAMES = new Set(['夜勤A', '夜勤B', '夜勤C']);
const DEMAND_SLOTS: string[] = ['7-9', '9-15', '16-18', '18-21', '21-23', '0-7'];

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

function extractYearMonthFromSchedule(data: ScheduleData): { year?: number; month?: number } {
  const sources: Record<string, unknown>[] = [];
  const root = data as unknown;
  if (isRecord(root)) {
    sources.push(root);
    const meta = root['meta'];
    if (isRecord(meta)) {
      sources.push(meta);
    }
    const inputEcho = root['inputEcho'];
    if (isRecord(inputEcho)) {
      sources.push(inputEcho);
      const nestedMeta = inputEcho['meta'];
      if (isRecord(nestedMeta)) {
        sources.push(nestedMeta);
      }
    }
  }

  for (const source of sources) {
    const yearValue = source['year'];
    const monthValue = source['month'];
    if (typeof yearValue === 'number' && Number.isFinite(yearValue) && typeof monthValue === 'number' && Number.isFinite(monthValue)) {
      return { year: yearValue, month: monthValue };
    }
  }

  return {};
}

function buildExcelFilename(schedule: ScheduleData, serverFilename?: string | null): string {
  if (serverFilename) {
    const trimmed = serverFilename.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  const { year, month } = extractYearMonthFromSchedule(schedule);
  if (typeof year === 'number' && typeof month === 'number') {
    return `${year}-${String(month).padStart(2, '0')}-シフト表.xlsx`;
  }
  return 'shift-schedule.xlsx';
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
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [pendingInput, setPendingInput] = useState<Record<string, unknown> | null>(null);
  const [inputAnalysis, setInputAnalysis] = useState<InputDetection | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const solverEnabled = isSolveAvailable;

  const solverErrorInfo = schedule?.error;
  const solverErrorMessage =
    solverErrorInfo && typeof solverErrorInfo === 'object' && solverErrorInfo !== null
      ? typeof solverErrorInfo.message === 'string' && solverErrorInfo.message
        ? solverErrorInfo.message
        : typeof solverErrorInfo.code === 'string'
        ? `solver error: ${solverErrorInfo.code}`
        : null
      : null;
  const demandDiagnostics = schedule?.summary?.diagnostics?.demand;
  const demandWarnings = useMemo(() => {
    const messages: string[] = [];
    if (solverErrorMessage) {
      messages.push(solverErrorMessage);
    }
    if (demandDiagnostics) {
      const warnings = Array.isArray(demandDiagnostics.warnings)
        ? demandDiagnostics.warnings.filter((item): item is string => typeof item === 'string')
        : [];
      messages.push(...warnings);
      if (warnings.length === 0 && demandDiagnostics.totalNeed === 0) {
        messages.push('総需要が0のため、全員休みのスケジュールになっています。入力条件を見直してください。');
      }
    }
    return messages;
  }, [demandDiagnostics, solverErrorMessage]);

  const scheduleStatus = useMemo(() => evaluateSolverOutputStatus(schedule), [schedule]);
  const suppressSchedule = scheduleStatus.hideSchedule;
  const solverStatusMessage = scheduleStatus.message;

  const solverDiagnostics = schedule?.diagnostics ?? null;
  const diagnosticsFlags = useMemo(() => {
    const rawFlags = solverDiagnostics?.flags;
    if (rawFlags && typeof rawFlags === 'object' && !Array.isArray(rawFlags)) {
      return rawFlags as Record<string, unknown>;
    }
    return {} as Record<string, unknown>;
  }, [solverDiagnostics]);

  const inconsistentSummaryFlag = Boolean(diagnosticsFlags.inconsistent_summary);
  const availabilityWarningFlag = Boolean(diagnosticsFlags.availability_warning);

  const solverWarnings = useMemo(() => {
    if (!solverDiagnostics || !Array.isArray(solverDiagnostics.warnings)) {
      return [] as string[];
    }
    const messages = solverDiagnostics.warnings.filter(
      (message): message is string => typeof message === 'string' && message.length > 0,
    );
    const unique = Array.from(new Set(messages));
    if (inconsistentSummaryFlag) {
      return unique.filter((message) => message !== INCONSISTENT_SUMMARY_MESSAGE);
    }
    return unique;
  }, [solverDiagnostics, inconsistentSummaryFlag]);

  const warningMessages = useMemo(() => {
    const combined = [...demandWarnings, ...solverWarnings];
    return Array.from(new Set(combined));
  }, [demandWarnings, solverWarnings]);

  const availabilityTable = useMemo(() => {
    const availability = solverDiagnostics?.availability;
    if (!availability || typeof availability !== 'object') {
      return [] as { day: number; slots: Record<string, number>; total: number }[];
    }
    const entries: { day: number; slots: Record<string, number>; total: number }[] = [];
    for (const [dayKey, rawSlots] of Object.entries(availability)) {
      if (!rawSlots || typeof rawSlots !== 'object') continue;
      const day = Number(dayKey);
      if (!Number.isFinite(day)) continue;
      const normalized: Record<string, number> = {};
      for (const slot of DEMAND_SLOTS) {
        const value = (rawSlots as Record<string, unknown>)[slot];
        normalized[slot] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }
      const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
      entries.push({ day, slots: normalized, total });
    }
    return entries.sort((a, b) => a.day - b.day);
  }, [solverDiagnostics]);

  const availabilityWarnings = useMemo(() => {
    if (!solverDiagnostics || !Array.isArray(solverDiagnostics.availabilityWarnings)) {
      return [] as { date: number; slot: string; need: number | null }[];
    }
    const entries = solverDiagnostics.availabilityWarnings
      .map((entry) => {
        const date = typeof entry?.date === 'number' ? entry.date : null;
        const slot = typeof entry?.slot === 'string' ? entry.slot : null;
        if (date === null || !slot) {
          return null;
        }
        const need = typeof entry?.need === 'number' && Number.isFinite(entry.need) ? entry.need : null;
        return { date, slot, need };
      })
      .filter((entry): entry is { date: number; slot: string; need: number | null } => entry !== null)
      .sort((a, b) => a.date - b.date);
    return entries;
  }, [solverDiagnostics]);

  const varCountEntries = useMemo(() => {
    if (!solverDiagnostics || typeof solverDiagnostics.var_counts !== 'object' || !solverDiagnostics.var_counts) {
      return [] as { key: string; value: number }[];
    }
    return Object.entries(solverDiagnostics.var_counts)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [solverDiagnostics]);

  const solverLogOutput = useMemo(() => {
    if (!solverDiagnostics) return '';
    const raw = solverDiagnostics.logOutput;
    if (typeof raw === 'string') {
      return raw.trim();
    }
    return '';
  }, [solverDiagnostics]);

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

      setAutoMessage('solver 実行完了：output.json を表示中');
      setNotice(`最終更新: ${timestamp}`);
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
      solverEnabled
        ? '「この入力で実行」ボタンで solver を実行し、結果を表示できます。'
        : 'solver API が無効化されているため、この入力では自動実行できません。',
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
      const statusInfo = evaluateSolverOutputStatus(solved);
      const detection = detectScheduleJson(solved);
      if (detection.kind !== 'output') {
        throw new Error('Solver result did not match the expected output schema.');
      }
      setSchedule(solved as ScheduleData);
      setError(null);
      const baseMessage = 'solver 実行完了：output.json を表示中';
      const noticeMessage =
        statusInfo.message && statusInfo.hideSchedule
          ? `${baseMessage}\n${statusInfo.message}`
          : baseMessage;
      setNotice(noticeMessage);
      setAutoMessage(null);
    } catch (solverError) {
      if (solverError instanceof SolveError) {
        console.error('solver execution failed', {
          status: solverError.status,
          body: solverError.body,
          payload: solverError.payload,
        });
        setError(
          solverError.message ||
            'solverの実行に失敗しました。開発サーバーのログを確認してください。',
        );
      } else {
        console.error(solverError);
        setError('solverの実行に失敗しました。開発サーバーのログを確認してください。');
      }
      setSchedule(null);
      setNotice(buildInputSummary(analysis));
      setAutoMessage(null);
    } finally {
      setIsSolving(false);
    }
  };

  const loadSample = async () => {
    try {
      let selected: SampleOption = SAMPLE_OUTPUT_OPTIONS[0];
      if (typeof window !== 'undefined' && SAMPLE_OUTPUT_OPTIONS.length > 1) {
        const message = SAMPLE_OUTPUT_OPTIONS.map(
          (option, index) => `${index + 1}. ${option.label}`,
        ).join('\n');
        const input = window.prompt(
          `読み込むサンプルを選択してください:\n${message}`,
          '1',
        );
        if (input === null) {
          return;
        }
        const choice = Number.parseInt(input, 10);
        const option = Number.isNaN(choice)
          ? undefined
          : SAMPLE_OUTPUT_OPTIONS[choice - 1];
        if (!option) {
          alert(`1〜${SAMPLE_OUTPUT_OPTIONS.length} の番号を入力してください。`);
          return;
        }
        selected = option;
      }

      const res = await fetch(selected.path, { cache: 'no-store' });
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
      alert(`${selected.label} を読み込みました`);
    } catch (e) {
      console.error(e);
      alert('サンプルデータの読み込みに失敗しました。READMEの「サンプル読込の準備」を参照してください。');
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
          if (solverEnabled) {
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
    NIGHT_SHIFT_CODES.has(shift) || NIGHT_SHIFT_NAMES.has(shift)
      ? 'bg-indigo-50 text-indigo-900'
      : '';

  const downloadExcel = async () => {
    if (!schedule || suppressSchedule || isDownloadingExcel) {
      return;
    }
    setIsDownloadingExcel(true);
    try {
      const result = await requestScheduleXlsx(schedule);
      const filename = buildExcelFilename(schedule, result.filename);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (exportError) {
      console.error('excel export failed', exportError);
      setError('Excelダウンロードに失敗しました。バックエンドAPIが起動しているか確認してください。');
      setNotice(null);
    } finally {
      setIsDownloadingExcel(false);
    }
  };

  const scheduleView = useMemo(() => {
    if (!schedule || suppressSchedule) return null;

    const matrix = Array.isArray(schedule.matrix) ? schedule.matrix : [];
    const dates = matrix.map((entry, index) => {
      const label = formatDate(entry.date);
      return {
        label,
        key: `${label}-${index}`,
      };
    });

    const rows = schedule.peopleOrder.map((person) => ({
      person,
      shifts: matrix.map((entry) => entry.shifts[person] ?? ''),
    }));

    return { dates, rows };
  }, [schedule, suppressSchedule]);

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
              onClick={() => schedule && !suppressSchedule && downloadCsv(schedule)}
              disabled={!schedule || suppressSchedule}
              className="rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              CSVダウンロード
            </button>
            <button
              type="button"
              onClick={() => void downloadExcel()}
              disabled={!schedule || suppressSchedule || isDownloadingExcel}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {isDownloadingExcel ? 'Excel生成中…' : 'Excelダウンロード'}
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
          <p className="text-sm text-slate-500">
            output.json はそのまま表示され、input.json は solver API を通じて結果を生成します。
            {!solverEnabled && ' solver API が無効化されている場合は output.json を直接読み込んでください。'}
          </p>
        </section>

        {notice && (
          <div
            className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 whitespace-pre-line"
            role="status"
          >
            {notice}
          </div>
        )}

        {warningMessages.length > 0 && (
          <div
            className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            role="alert"
          >
            {warningMessages.map((message, index) => (
              <p key={`${message}-${index}`}>{message}</p>
            ))}
          </div>
        )}

        {inconsistentSummaryFlag && (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            role="alert"
          >
            {INCONSISTENT_SUMMARY_MESSAGE}
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

        {schedule && solverStatusMessage && (
          <div
            className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 whitespace-pre-line"
            role="alert"
          >
            {solverStatusMessage}
          </div>
        )}

        {solverLogOutput && (
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="solverログ">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Solver ログ</h2>
              <p className="text-xs text-slate-500">バックエンドで実行された solver の標準出力です。</p>
            </div>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-100">{solverLogOutput}</pre>
          </section>
        )}

        {solverEnabled && pendingInput && inputAnalysis && (
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
              solver API を呼び出して output.json 相当の結果を表示します。
            </p>
          </div>
        )}
        {!solverEnabled && pendingInput && inputAnalysis && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
            solver API が無効化されているため、この入力JSONを自動実行できません。設定を確認するか、output.json を直接読み込んでください。
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

        {demandDiagnostics && (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="需要診断">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">需要診断</h2>
              <p className="text-sm text-slate-500">solver が展開した需要テンプレートの概要です。</p>
            </div>
            <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-md bg-slate-100 px-3 py-2">
                <dt className="font-medium text-slate-600">days</dt>
                <dd>{demandDiagnostics.days ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-slate-100 px-3 py-2">
                <dt className="font-medium text-slate-600">weekdayOfDay1</dt>
                <dd>{demandDiagnostics.weekdayOfDay1 ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-slate-100 px-3 py-2 sm:col-span-2">
                <dt className="font-medium text-slate-600">totalNeed</dt>
                <dd>{demandDiagnostics.totalNeed ?? 0}</dd>
              </div>
              {Array.isArray(demandDiagnostics.dayTypeSample) && demandDiagnostics.dayTypeSample.length > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-md bg-slate-100 px-3 py-2 sm:col-span-2">
                  <dt className="font-medium text-slate-600">dayType sample</dt>
                  <dd className="truncate text-right">{demandDiagnostics.dayTypeSample.join(', ')}</dd>
                </div>
              )}
            </dl>
            {Array.isArray(demandDiagnostics.perDayTotals) && demandDiagnostics.perDayTotals.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th scope="col" className="border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                        日付
                      </th>
                      <th scope="col" className="border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                        合計
                      </th>
                      {DEMAND_SLOTS.map((slot) => (
                        <th
                          key={`diag-slot-${slot}`}
                          scope="col"
                          className="border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                        >
                          {slot}
                        </th>
                      ))}
                      <th scope="col" className="border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                        carry
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {demandDiagnostics.perDayTotals.map((entry) => {
                      const slots = entry.slots ?? {};
                      return (
                        <tr key={`diag-day-${entry.date ?? 'unknown'}`} className="odd:bg-white even:bg-slate-50">
                          <td className="border border-slate-200 px-3 py-2">{entry.date ?? '—'}</td>
                          <td className="border border-slate-200 px-3 py-2">{entry.total ?? 0}</td>
                          {DEMAND_SLOTS.map((slot) => (
                            <td key={`diag-day-${entry.date}-${slot}`} className="border border-slate-200 px-3 py-2">
                              {slots[slot] ?? 0}
                            </td>
                          ))}
                          <td className="border border-slate-200 px-3 py-2">{entry.carryApplied ? 'あり' : 'なし'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {availabilityTable.length > 0 && (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="可用性診断">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">可用性診断</h2>
              <p className="text-sm text-slate-500">
                各日・各時間帯で勤務可能な人数を表示します。固定休や個別の不可日を考慮した概算です。
              </p>
            </div>
            {availabilityWarningFlag && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
                <p>{AVAILABILITY_WARNING_MESSAGE}</p>
              </div>
            )}
            {availabilityWarnings.length > 0 && (
              <div className="rounded-md border border-amber-100 bg-amber-100 px-4 py-3 text-sm text-amber-900">
                <p className="font-medium">可用性が 0 のスロット</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {availabilityWarnings.map(({ date, slot, need }) => (
                    <li key={`availability-warning-${date}-${slot}`}>
                      日 {date} / {slot}（需要 {need ?? 0}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th scope="col" className="border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                      日付
                    </th>
                    <th scope="col" className="border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                      合計
                    </th>
                    {DEMAND_SLOTS.map((slot) => (
                      <th
                        key={`availability-slot-${slot}`}
                        scope="col"
                        className="border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                      >
                        {slot}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {availabilityTable.map(({ day, slots, total }) => (
                    <tr key={`availability-day-${day}`} className="odd:bg-white even:bg-slate-50">
                      <td className="border border-slate-200 px-3 py-2">{day}</td>
                      <td className="border border-slate-200 px-3 py-2">{total}</td>
                      {DEMAND_SLOTS.map((slot) => {
                        const value = slots[slot] ?? 0;
                        const cellClass = value === 0 ? 'text-red-600 font-semibold' : '';
                        return (
                          <td key={`availability-day-${day}-${slot}`} className={`border border-slate-200 px-3 py-2 ${cellClass}`}>
                            {value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {varCountEntries.length > 0 && (
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="solver変数情報">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Solver 変数数</h2>
              <p className="text-sm text-slate-500">主要な決定変数の個数です。0 の場合はモデル構築に失敗しています。</p>
            </div>
            <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
              {varCountEntries.map(({ key, value }) => (
                <div key={`var-count-${key}`} className="flex items-center justify-between gap-3 rounded-md bg-slate-100 px-3 py-2">
                  <dt className="font-medium text-slate-600">{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

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
        ) : schedule ? (
          <p className="text-sm text-slate-500">シフト表は現在表示されていません。条件や需要設定を確認してください。</p>
        ) : (
          <p className="text-sm text-slate-500">output.json を読み込むとシフト表が表示されます。</p>
        )}
      </main>
    </div>
  );
}
