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

export const isSolveAvailable = import.meta.env.DEV;

export async function requestSolve(input: SolveInput): Promise<SolveOutput> {
  const response = await fetch('/api/solve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new SolveError('Solver request failed', response.status, responseText);
  }

  try {
    return JSON.parse(responseText) as SolveOutput;
  } catch (error) {
    throw new SolveError('Solver response was not valid JSON', response.status, responseText);
  }
}
