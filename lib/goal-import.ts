/**
 * Safe Monarch goal migration. The parser accepts the Monarch configuration
 * export shape; the plan builder matches existing FundFlow goals by a stable
 * imported identifier (or an unambiguous name+type pair, never by name alone)
 * and surfaces conflicts before any write. Applying preserves FundFlow
 * contribution events and allocation caps.
 */

export const GOAL_IMPORT_VERSION = 1;

export type GoalImportType = "save_up" | "pay_down";

export interface GoalImportRow {
  importedId: string | null;
  name: string;
  goalType: GoalImportType;
  targetAmount: number | null;
  targetDate: string | null;
  linkedAccountName: string | null;
  monthlyContribution: number | null;
}

export interface GoalImportResult {
  rows: GoalImportRow[];
  errors: string[];
}

export interface ExistingGoal {
  id: string;
  name: string;
  goal_type: string;
  target_amount: number | string;
  target_date: string | null;
  import_source: string | null;
  import_ref: string | null;
}

export interface GoalImportConflict {
  existingGoalId: string;
  name: string;
  existingTarget: number;
  incomingTarget: number | null;
}

export interface GoalImportPlan {
  version: number;
  rows: GoalImportRow[];
  conflicts: GoalImportConflict[];
}

function toAmount(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

function toDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * Parse a Monarch goals configuration export: `{ goals: [...] }` with id, name,
 * type (save_up/pay_down), target amount, target date, account, and monthly
 * contribution.
 */
export function parseMonarchGoals(text: string): GoalImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], errors: ["Could not parse the goals file as JSON."] };
  }
  const goals = Array.isArray(parsed)
    ? (parsed as Array<Record<string, unknown>>)
    : Array.isArray((parsed as { goals?: unknown })?.goals)
      ? ((parsed as { goals: unknown }).goals as Array<Record<string, unknown>>)
      : null;
  if (!goals) {
    return { rows: [], errors: ["The goals file has no goals to import."] };
  }

  const rows: GoalImportRow[] = [];
  const errors: string[] = [];
  for (const goal of goals) {
    const name = typeof goal.name === "string" ? goal.name.trim() : "";
    if (!name || name.length > 120) {
      errors.push("Skipped a goal with no usable name.");
      continue;
    }
    const type = goal.type === "pay_down" ? "pay_down" : "save_up";
    rows.push({
      importedId:
        typeof goal.id === "string" && goal.id.length > 0 && goal.id.length <= 200
          ? goal.id
          : null,
      name,
      goalType: type,
      targetAmount: toAmount(goal.target_amount),
      targetDate: toDate(goal.target_date),
      linkedAccountName:
        typeof goal.account_name === "string" && goal.account_name.trim()
          ? goal.account_name.trim().slice(0, 120)
          : null,
      monthlyContribution: toAmount(goal.monthly_contribution),
    });
  }
  return { rows, errors };
}

/**
 * Match an imported goal to an existing FundFlow goal. A stable imported
 * identifier wins; otherwise only an unambiguous (name, goal_type) pair
 * matches — never name alone.
 */
export function matchGoal(
  row: Pick<GoalImportRow, "importedId" | "name" | "goalType">,
  existing: ExistingGoal[],
): ExistingGoal | null {
  if (row.importedId) {
    const byRef = existing.find(
      (goal) => goal.import_source === "monarch" && goal.import_ref === row.importedId,
    );
    if (byRef) return byRef;
  }
  const candidates = existing.filter(
    (goal) =>
      goal.name.toLowerCase() === row.name.toLowerCase() &&
      goal.goal_type === row.goalType,
  );
  return candidates.length === 1 ? candidates[0]! : null;
}

export function buildGoalImportPlan(
  rows: GoalImportRow[],
  existing: ExistingGoal[],
): GoalImportPlan {
  const conflicts: GoalImportConflict[] = [];
  for (const row of rows) {
    const match = matchGoal(row, existing);
    if (!match) continue;
    const existingTarget = Math.round(Number(match.target_amount) * 100) / 100;
    const incoming = row.targetAmount;
    if (incoming !== null && Math.abs(existingTarget - incoming) >= 0.01) {
      conflicts.push({
        existingGoalId: match.id,
        name: match.name,
        existingTarget,
        incomingTarget: incoming,
      });
    }
  }
  return { version: GOAL_IMPORT_VERSION, rows, conflicts };
}