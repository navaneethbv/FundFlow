import { createHash } from "node:crypto";

/**
 * Versioned, provider-neutral budget import model. The parser accepts the
 * Monarch configuration export shape; the plan builder maps it to FundFlow's
 * budget groups and reports conflicts and unbudgeted categories so nothing is
 * silently overwritten. Applying is idempotent and owner-scoped.
 */

export const BUDGET_IMPORT_VERSION = 1;

export type BudgetGroupKind =
  | "income"
  | "fixed"
  | "flexible"
  | "non_monthly"
  | "custom";

export interface BudgetImportRow {
  category: string;
  monthlyAmount: number;
  group: BudgetGroupKind;
  /** Preserved original group name for `custom` groups. */
  groupName: string | null;
}

export interface BudgetImportResult {
  rows: BudgetImportRow[];
  errors: string[];
}

export interface BudgetImportConflict {
  category: string;
  existingAmount: number;
  incomingAmount: number;
}

export interface BudgetImportPlan {
  version: number;
  rows: BudgetImportRow[];
  conflicts: BudgetImportConflict[];
  /** Categories already budgeted in FundFlow that Monarch does not include. */
  unbudgetedCategories: string[];
}

const GROUP_MAP: Record<string, BudgetGroupKind> = {
  income: "income",
  fixed: "fixed",
  flexible: "flexible",
  non_monthly: "non_monthly",
  "non-monthly": "non_monthly",
  sinking: "non_monthly",
  other: "non_monthly",
};

function toAmount(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function normalizeCategory(category: unknown): string | null {
  if (typeof category !== "string") return null;
  const trimmed = category.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : null;
}

interface RawGroup {
  name?: unknown;
  type?: unknown;
  categories?: unknown;
}

interface RawCategory {
  name?: unknown;
  amount?: unknown;
}

/**
 * Parse a Monarch budget configuration export. Accepts either `{ groups: [...] }`
 * or a bare array of groups; each group carries a name, a type, and a category
 * list with per-category monthly amounts.
 */
export function parseMonarchBudgets(text: string): BudgetImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], errors: ["Could not parse the budget file as JSON."] };
  }
  const groups = Array.isArray(parsed)
    ? (parsed as RawGroup[])
    : Array.isArray((parsed as { groups?: unknown })?.groups)
      ? ((parsed as { groups: unknown }).groups as RawGroup[])
      : null;
  if (!groups) {
    return { rows: [], errors: ["The budget file has no groups to import."] };
  }

  const rows: BudgetImportRow[] = [];
  const errors: string[] = [];
  for (const group of groups) {
    const groupName = typeof group.name === "string" ? group.name.trim() : null;
    const rawType = typeof group.type === "string" ? group.type.trim().toLowerCase() : "";
    const groupKind = GROUP_MAP[rawType] ?? "custom";
    for (const rawCategory of (Array.isArray(group.categories) ? group.categories : []) as RawCategory[]) {
      const category = normalizeCategory(rawCategory.name);
      const amount = toAmount(rawCategory.amount);
      if (!category) {
        errors.push(`Skipped a category with no usable name in group "${groupName ?? "?"}".`);
        continue;
      }
      if (amount === null) {
        errors.push(`Skipped category "${category}" with an unusable amount.`);
        continue;
      }
      rows.push({
        category,
        monthlyAmount: amount,
        group: groupKind,
        groupName: groupKind === "custom" ? groupName : null,
      });
    }
  }
  return { rows, errors };
}

export interface ExistingBudget {
  category: string;
  monthly_limit: number | string;
  group_name: string;
}

/** The fingerprint used for idempotent re-imports. */
export function budgetFingerprint(category: string, amount: number): string {
  return createHash("sha256")
    .update([category.toLowerCase(), amount.toFixed(2)].join("|"))
    .digest("hex")
    .slice(0, 40);
}

export function buildBudgetImportPlan(
  rows: BudgetImportRow[],
  existing: ExistingBudget[],
): BudgetImportPlan {
  const existingByCategory = new Map(
    existing.map((budget) => [budget.category.toLowerCase(), budget]),
  );
  const conflicts: BudgetImportConflict[] = [];
  const unbudgeted = new Set(existing.map((budget) => budget.category));
  for (const row of rows) {
    const current = existingByCategory.get(row.category.toLowerCase());
    if (!current) continue;
    unbudgeted.delete(current.category);
    const existingAmount = Math.round(Number(current.monthly_limit) * 100) / 100;
    if (Math.abs(existingAmount - row.monthlyAmount) >= 0.01) {
      conflicts.push({
        category: current.category,
        existingAmount,
        incomingAmount: row.monthlyAmount,
      });
    }
  }
  return {
    version: BUDGET_IMPORT_VERSION,
    rows,
    conflicts,
    unbudgetedCategories: [...unbudgeted].sort((a, b) => a.localeCompare(b)),
  };
}