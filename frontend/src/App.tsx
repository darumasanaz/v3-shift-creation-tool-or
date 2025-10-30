import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';

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
  { key: 'violatedPreferences', label: '希望休違反' },
];

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

export default function App() {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        if (typeof text !== 'string') {
          throw new Error('ファイルを読み込めませんでした');
        }
        const parsed = JSON.parse(text) as ScheduleData;
        if (!Array.isArray(parsed.peopleOrder) || !Array.isArray(parsed.matrix)) {
          throw new Error('想定した形式のJSONではありません');
        }
        setSchedule(parsed);
        setError(null);
      } catch (e) {
        console.error(e);
        setSchedule(null);
        setError('JSONの解析に失敗しました。ファイル形式を確認してください。');
      }
    };
    reader.onerror = () => {
      setError('ファイルの読み込み中にエラーが発生しました。');
      setSchedule(null);
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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <h1 className="text-2xl font-semibold text-slate-900">出力JSONビューア</h1>
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
          <p className="text-lg font-medium text-slate-800">ここに output.json をドロップ</p>
          <p className="text-sm text-slate-500">または上のボタンからファイルを選択してください</p>
        </section>

        {error && (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}
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

        {schedule ? (
          <section
            className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm"
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
                    日付
                  </th>
                  {schedule.peopleOrder.map((person) => (
                    <th
                      key={person}
                      scope="col"
                      className="sticky top-0 z-10 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700"
                    >
                      {person}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.matrix.map((entry, rowIndex) => {
                  const formattedDate = formatDate(entry.date);
                  return (
                    <tr key={`${formattedDate}-${rowIndex}`} className="odd:bg-white even:bg-slate-50">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 border-r border-slate-200 bg-inherit px-4 py-3 text-left text-sm font-semibold text-slate-700"
                      >
                        {formattedDate}
                      </th>
                      {schedule.peopleOrder.map((person) => {
                        const shift = entry.shifts[person] ?? '';
                        return (
                          <td
                            key={`${formattedDate}-${person}`}
                            className={`border-r border-slate-200 px-4 py-3 text-sm font-medium text-slate-800 ${nightShiftClass(shift)}`}
                          >
                            {shift || '休'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
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
