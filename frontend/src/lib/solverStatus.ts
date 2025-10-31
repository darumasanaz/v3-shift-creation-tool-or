const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { message, code } = value;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  if (typeof code === 'string' && code.trim()) {
    return `solver error: ${code.trim()}`;
  }
  return null;
};

const extractDemandTotalNeed = (summary: Record<string, unknown> | null): number | null => {
  if (!summary) return null;
  const diagnostics = summary.diagnostics;
  if (!isRecord(diagnostics)) return null;
  const demand = diagnostics.demand;
  if (!isRecord(demand)) return null;
  const totalNeed = demand.totalNeed;
  if (typeof totalNeed === 'number' && Number.isFinite(totalNeed)) {
    return totalNeed;
  }
  return null;
};

export type SolverOutputStatus = {
  hideSchedule: boolean;
  message: string | null;
};

export const DEFAULT_INFEASIBLE_MESSAGE = '不可解です。条件を緩めて再実行してください。';
export const DEFAULT_EMPTY_ASSIGNMENT_MESSAGE =
  '割り当てが1件もないため、シフト表を表示できません。条件を見直して再実行してください。';
export const DEFAULT_ZERO_NEED_MESSAGE =
  '総需要が0のため、割り当て表は表示されません。需要テンプレートや曜日設定を確認してください。';

export function evaluateSolverOutputStatus(payload: unknown): SolverOutputStatus {
  if (!isRecord(payload)) {
    return { hideSchedule: false, message: null };
  }

  const errorInfo = payload.error;
  const errorMessage = extractErrorMessage(errorInfo);

  if (payload.infeasible === true) {
    const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : errorMessage;
    return {
      hideSchedule: true,
      message: reason ?? DEFAULT_INFEASIBLE_MESSAGE,
    };
  }

  let assignmentCount = 0;
  const assignments = payload.assignments;
  if (Array.isArray(assignments)) {
    assignmentCount = assignments.length;
  }

  const summaryRaw = payload.summary;
  const summary = isRecord(summaryRaw) ? summaryRaw : null;
  if (summary) {
    const totalsRaw = summary.totals;
    if (isRecord(totalsRaw)) {
      const assigned = totalsRaw.assigned;
      if (typeof assigned === 'number' && Number.isFinite(assigned)) {
        assignmentCount = Math.max(assignmentCount, assigned);
      }
    }
  }

  if (assignmentCount <= 0) {
    const totalNeed = extractDemandTotalNeed(summary);
    if (totalNeed === 0) {
      return { hideSchedule: true, message: errorMessage ?? DEFAULT_ZERO_NEED_MESSAGE };
    }
    return { hideSchedule: true, message: errorMessage ?? DEFAULT_EMPTY_ASSIGNMENT_MESSAGE };
  }

  if (errorMessage) {
    return { hideSchedule: false, message: errorMessage };
  }

  return { hideSchedule: false, message: null };
}
