export type SolveInput = Record<string, unknown>;
export type SolveOutput = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class SolveError extends Error {
  public readonly status: number;

  public readonly body: string;

  public readonly payload: unknown;

  constructor(message: string, status: number, body: string, payload?: unknown) {
    super(message);
    this.name = 'SolveError';
    this.status = status;
    this.body = body;
    this.payload = payload;
  }
}

const configuredBase =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.VITE_SOLVE_API_BASE as string | undefined) ??
  '';

export const API_BASE_URL = configuredBase.replace(/\/+$/, '');
export const SOLVE_API_BASE_URL = API_BASE_URL;

const SOLVE_API_DISABLED =
  (import.meta.env.VITE_SOLVE_API_DISABLED as string | undefined)?.toLowerCase() === 'true' ||
  import.meta.env.VITE_SOLVE_API_DISABLED === '1';

export const isSolveAvailable = !SOLVE_API_DISABLED;

const buildEndpoint = (path: string) => (API_BASE_URL ? `${API_BASE_URL}${path}` : path);

export async function requestSolve(input: SolveInput): Promise<SolveOutput> {
  if (!isSolveAvailable) {
    throw new SolveError('Solver API is disabled by configuration.', 503, '');
  }

  let response: Response;
  try {
    response = await fetch(buildEndpoint('/api/solve'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  } catch (networkError) {
    const message =
      networkError instanceof Error && networkError.message
        ? networkError.message
        : 'Failed to connect to solver API.';
    throw new SolveError(message, 0, '', networkError);
  }

  const responseText = await response.text();
  let parsed: unknown = null;
  let parseError: Error | null = null;
  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      parseError = error instanceof Error ? error : new Error('Failed to parse solver response.');
    }
  }

  if (!response.ok) {
    const message =
      (isRecord(parsed) && typeof parsed.error === 'string' && parsed.error) ||
      `Solver request failed with status ${response.status}`;
    throw new SolveError(message, response.status, responseText, parsed);
  }

  if (parseError || !isRecord(parsed)) {
    throw new SolveError('Solver response was not valid JSON', response.status, responseText, parsed);
  }

  if (parsed.ok !== true) {
    const message =
      (typeof parsed.error === 'string' && parsed.error) || 'Solver execution failed. 詳細はログを確認してください。';
    throw new SolveError(message, response.status, responseText, parsed);
  }

  const output = parsed.output;
  if (!isRecord(output)) {
    throw new SolveError('Solver response did not include output data.', response.status, responseText, parsed);
  }

  return output as SolveOutput;
}
