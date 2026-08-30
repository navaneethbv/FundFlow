/**
 * Safe Monarch goal migration. The parser accepts the Monarch configuration
 * export shape; the plan builder matches existing FundFlow goals by a stable
 * imported identifier (or an unambiguous name+type pair, never by name alone)
 * and surfaces conflicts before any write. Applying preserves FundFlow
 * contribution events and allocation caps.
 */

export const GOAL_IMPORT_VERSION = 2;

export type GoalImportType = "save_up" | "pay_down";
export type GoalImportDecision = "create" | "merge" | "replace" | "skip";

export interface GoalImportProvidedFields {
  targetAmount: boolean;
  targetDate: boolean;
  monthlyContribution: boolean;
}

export interface GoalImportRow {
  importedId: string | null;
  name: string;
  goalType: GoalImportType;
  targetAmount: number | null;
  targetDate: string | null;
  linkedAccountName: string | null;
  allocationAmount: number | null;
  useEntireBalance: boolean;
  monthlyContribution: number | null;
  providedFields: GoalImportProvidedFields;
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
  monthly_contribution: number | string | null;
  import_source: string | null;
  import_ref: string | null;
}

export interface GoalImportPlanRow extends GoalImportRow {
  decisionKey: string;
  matchedGoalId: string | null;
  defaultDecision: "create" | "merge";
  allowedDecisions: GoalImportDecision[];
}

export interface GoalImportConflict {
  existingGoalId: string;
  name: string;
  existingTarget: number;
  incomingTarget: number | null;
}

export interface GoalImportPlan {
  version: number;
  rows: GoalImportPlanRow[];
  conflicts: GoalImportConflict[];
}

function toAmount(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

function toNonNegativeAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function toDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function readGoalEntries(parsed: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (typeof parsed !== "object" || parsed === null) return null;
  const goals = (parsed as { goals?: unknown }).goals;
  return Array.isArray(goals) ? goals as Array<Record<string, unknown>> : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGoalAllocation(goal: Record<string, unknown>): {
  accountName: string | null;
  allocationAmount: number | null;
  useEntireBalance: boolean;
} {
  const allocation = isRecord(goal.allocation) ? goal.allocation : null;
  const accountValue = goal.account_name ?? allocation?.account_name;
  const accountName = typeof accountValue === "string" ? accountValue.trim() : "";
  const amountValue =
    goal.allocation_amount ??
    goal.allocated_amount ??
    allocation?.amount ??
    allocation?.allocated_amount;
  const useEntireBalance =
    goal.use_entire_balance === true || allocation?.use_entire_balance === true;
  return {
    accountName: accountName ? accountName.slice(0, 120) : null,
    allocationAmount: useEntireBalance ? null : toAmount(amountValue),
    useEntireBalance,
  };
}

function parseGoalEntry(goal: Record<string, unknown>): GoalImportRow | null {
  const name = typeof goal.name === "string" ? goal.name.trim() : "";
  if (!name || name.length > 120) return null;
  const type = goal.type === "pay_down" ? "pay_down" : "save_up";
  const importedId =
    typeof goal.id === "string" && goal.id.length > 0 && goal.id.length <= 200
      ? goal.id
      : null;
  const allocation = parseGoalAllocation(goal);
  const providedFields = {
    targetAmount: Object.hasOwn(goal, "target_amount"),
    targetDate: Object.hasOwn(goal, "target_date"),
    monthlyContribution: Object.hasOwn(goal, "monthly_contribution"),
  };
  return {
    importedId,
    name,
    goalType: type,
    targetAmount: toAmount(goal.target_amount),
    targetDate: toDate(goal.target_date),
    linkedAccountName: allocation.accountName,
    allocationAmount: allocation.allocationAmount,
    useEntireBalance: allocation.useEntireBalance,
    monthlyContribution: toNonNegativeAmount(goal.monthly_contribution),
    providedFields,
  };
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
  const goals = readGoalEntries(parsed);
  if (!goals) {
    return { rows: [], errors: ["The goals file has no goals to import."] };
  }

  const rows: GoalImportRow[] = [];
  const errors: string[] = [];
  const importedIds = new Set<string>();
  for (const goal of goals) {
    const row = parseGoalEntry(goal);
    if (!row) {
      errors.push("Skipped a goal with no usable name.");
      continue;
    }
    if (row.importedId && importedIds.has(row.importedId)) {
      errors.push("The goals file contains a duplicate imported goal identifier.");
      continue;
    }
    if (row.importedId) importedIds.add(row.importedId);
    rows.push(row);
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
  const planRows = rows.map((row, index): GoalImportPlanRow => {
    const match = matchGoal(row, existing);
    if (match) {
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
    return {
      ...row,
      decisionKey: `goal:${index}`,
      matchedGoalId: match?.id ?? null,
      defaultDecision: match ? "merge" : "create",
      allowedDecisions: match
        ? ["merge", "replace", "skip"]
        : ["create", "skip"],
    };
  });
  return { version: GOAL_IMPORT_VERSION, rows: planRows, conflicts };
}
