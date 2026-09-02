/**
 * Pure logic behind "Copy last month's budget" (`POST /api/budget/copy` and
 * the CopyLastMonthButton): the previous-month key, request validation, and
 * the merge/overwrite plan. Kept free of I/O so the conflict rules are unit
 * testable without Supabase.
 *
 * Copy semantics: `budgets` rows (category, group, rollover) are month-agnostic
 * and persist; only `budget_periods.planned` is month-scoped. So a copy is a
 * set of planned-amount upserts keyed by the same `budget_id` — no name
 * matching, and rollover choices are untouched (the route passes null for
 * every non-planned field of `update_budget_period`).
 */

export type CopyMode = "merge" | "overwrite";

export interface CopyPlanRow {
  budgetId: string;
  planned: number;
}

export interface CopyPlan {
  /** Planned-amount upserts to write for the target month. */
  rows: CopyPlanRow[];
  /** Target-month rows that already exist (the conflict count). */
  conflicts: number;
  /** Source rows not copied because the target already has them (merge mode). */
  skipped: number;
}

export interface PeriodRow {
  budget_id: string;
  planned: number | string;
}

/** "2026-01" → "2025-12"; pure string math, no timezone surprises. */
export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year! * 12 + (monthNumber! - 1) - 1;
  const previousYear = Math.floor(total / 12);
  const previousMonthNumber = (total % 12) + 1;
  return `${previousYear}-${String(previousMonthNumber).padStart(2, "0")}`;
}

export type CopyBodyResult =
  | { ok: true; month: string; mode?: CopyMode }
  | { ok: false; message: string };

const YYYY_MM_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export function parseCopyBody(value: unknown): CopyBodyResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid JSON payload" };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.month !== "string" || !YYYY_MM_REGEX.test(body.month)) {
    return { ok: false, message: "Invalid month" };
  }
  if (body.mode !== undefined && body.mode !== "merge" && body.mode !== "overwrite") {
    return { ok: false, message: "Invalid mode" };
  }
  return { ok: true, month: body.month, mode: body.mode as CopyMode | undefined };
}

/**
 * Plan the copy. Without a mode the caller is expected to have verified the
 * target month is empty (the route answers 409 otherwise) — the plan then
 * copies everything. `merge` fills only empty envelopes; `overwrite` restates
 * every source value and is never invoked without an explicit confirmation.
 */
export function planCopy(
  source: readonly PeriodRow[],
  existing: readonly PeriodRow[],
  mode?: CopyMode,
): CopyPlan {
  const existingIds = new Set(existing.map((row) => row.budget_id));
  const rows: CopyPlanRow[] = [];
  let skipped = 0;
  for (const row of source) {
    const planned = Number(row.planned);
    if (mode === "merge" && existingIds.has(row.budget_id)) {
      skipped += 1;
      continue;
    }
    if (!Number.isFinite(planned) || planned < 0) {
      skipped += 1;
      continue;
    }
    rows.push({ budgetId: row.budget_id, planned });
  }
  return { rows, conflicts: existing.length, skipped };
}
