export type SolveInput = Record<string, unknown>;
export type SolveOutput = Record<string, unknown>;

export class SolveError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'SolveError';
    this.status = status;
    this.body = body;
  }
}

const SOLVE_API_BASE = (import.meta.env.VITE_SOLVE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '';
const SOLVE_API_DISABLED =
  (import.meta.env.VITE_SOLVE_API_DISABLED as string | undefined)?.toLowerCase() === 'true' ||
  import.meta.env.VITE_SOLVE_API_DISABLED === '1';

export const isSolveAvailable = !SOLVE_API_DISABLED;

export async function requestSolve(input: SolveInput): Promise<SolveOutput> {
  if (!isSolveAvailable) {
    throw new SolveError('Solver API is disabled by configuration.', 503, '');
  }

  const response = await fetch(`${SOLVE_API_BASE}/api/solve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const responseText = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    throw new SolveError('Solver request failed', response.status, responseText);
  }

  try {
    if (contentType.includes('application/json')) {
      return JSON.parse(responseText) as SolveOutput;
    }
    return JSON.parse(responseText || '{}') as SolveOutput;
  } catch (error) {
    throw new SolveError('Solver response was not valid JSON', response.status, responseText);
  }
}
