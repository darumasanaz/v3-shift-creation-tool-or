import { SOLVE_API_BASE_URL } from './solveClient';

const EXCEL_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const filenameStarMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (filenameStarMatch && filenameStarMatch[1]) {
    try {
      return decodeURIComponent(filenameStarMatch[1]);
    } catch {
      return filenameStarMatch[1];
    }
  }
  const filenameMatch = header.match(/filename="?([^";]+)"?/i);
  if (filenameMatch && filenameMatch[1]) {
    return filenameMatch[1];
  }
  return null;
}

export type ExcelExportResult = {
  blob: Blob;
  filename: string | null;
};

export async function requestScheduleXlsx(payload: unknown): Promise<ExcelExportResult> {
  const response = await fetch(`${SOLVE_API_BASE_URL}/api/export-xlsx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: EXCEL_MIME_TYPE,
    },
    body: JSON.stringify(payload ?? {}),
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    const errorText = await response.text();
    const message = `Excel export request failed with status ${response.status}`;
    throw new Error(`${message}: ${errorText}`);
  }
  if (!contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
    // Fallback: still try to read as blob.
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition');
  const filename = parseContentDispositionFilename(disposition);
  return { blob, filename };
}
