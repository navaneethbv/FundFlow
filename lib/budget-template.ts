/**
 * Pure logic behind saved budget templates (features.md #4): validating a
 * template's item list and planning an apply onto a target month.
 *
 * Applying mirrors the copy-last-month semantics: `budgets` rows are
 * month-agnostic, so an apply is a set of planned-amount upserts keyed by the
 * budget whose lowercase category matches the template item. A template item
 * with no matching budget row is skipped and reported — never silently
 * created. The overwrite/merge choice is explicit: a target month that
 * already has envelopes produces conflicts, and the caller must confirm.
 */

import type { BudgetGroup } from "@/lib/budget-page";

export interface BudgetTemplateItem {
  category: string;
  group_name: BudgetGroup;
  planned: number;
  rollover_enabled: boolean;
}

export type TemplateItemsResult =
  | { ok: true; value: BudgetTemplateItem[] }
  | { ok: false; message: string };

const BUDGET_GROUPS = new Set<BudgetGroup>(["income", "fixed", "flexible", "non_monthly"]);
const MAX_ITEMS = 200;

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
}

/** Validates the jsonb payload stored on `budget_templates.items`. */
export function parseTemplateItems(value: unknown): TemplateItemsResult {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) {
    return { ok: false, message: "Invalid template items" };
  }
  const items: BudgetTemplateItem[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, message: "Invalid template item" };
    }
    const row = candidate as Record<string, unknown>;
    const category = typeof row.category === "string" ? row.category.trim() : "";
    if (!category || category.length > 120) {
      return { ok: false, message: "Invalid template category" };
    }
    if (
      typeof row.group_name !== "string" ||
      !BUDGET_GROUPS.has(row.group_name as BudgetGroup)
    ) {
      return { ok: false, message: "Invalid template group" };
    }
    if (
      typeof row.planned !== "number" ||
      !Number.isFinite(row.planned) ||
      row.planned < 0 ||
      !hasAtMostTwoDecimals(row.planned)
    ) {
      return { ok: false, message: "Invalid template amount" };
    }
    if (typeof row.rollover_enabled !== "boolean") {
      return { ok: false, message: "Invalid template rollover" };
    }
    items.push({
      category,
      group_name: row.group_name as BudgetGroup,
      planned: row.planned,
      rollover_enabled: row.rollover_enabled,
    });
  }
  return { ok: true, value: items };
}

export interface TemplateApplyRow {
  budgetId: string;
  planned: number;
}

export interface TemplateApplyPlan {
  /** Planned-amount upserts to write for the target month. */
  rows: TemplateApplyRow[];
  /** Template items whose category has no matching budget row. */
  unmatched: string[];
  /** Target-month rows that already exist (the conflict count). */
  conflicts: number;
  /** Items not written because the target already has them (merge mode). */
  skipped: number;
}

export function planTemplateApply(
  items: readonly BudgetTemplateItem[],
  budgets: readonly { id: string; category: string }[],
  existing: readonly { budget_id: string }[],
  mode?: "merge" | "overwrite",
): TemplateApplyPlan {
  const budgetIdByCategory = new Map(
    budgets.map((budget) => [budget.category.trim().toLowerCase(), budget.id]),
  );
  const existingIds = new Set(existing.map((row) => row.budget_id));
  const rows: TemplateApplyRow[] = [];
  const unmatched: string[] = [];
  let skipped = 0;

  for (const item of items) {
    const budgetId = budgetIdByCategory.get(item.category.trim().toLowerCase());
    if (!budgetId) {
      unmatched.push(item.category);
      continue;
    }
    if (mode === "merge" && existingIds.has(budgetId)) {
      skipped += 1;
      continue;
    }
    rows.push({ budgetId, planned: item.planned });
  }

  return { rows, unmatched, conflicts: existing.length, skipped };
}
