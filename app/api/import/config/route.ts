import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import {
  parseMonarchBudgets,
  buildBudgetImportPlan,
  type BudgetImportRow,
} from "@/lib/budget-import";
import {
  parseMonarchGoals,
  buildGoalImportPlan,
  type GoalImportDecision,
  type GoalImportPlan,
  type GoalImportPlanRow,
  type GoalImportRow,
} from "@/lib/goal-import";
import { isLiabilityAccount } from "@/lib/goals-v2";
import { checkRateLimit } from "@/lib/rate-limit";

type BudgetDecision = "merge" | "replace-month" | "skip";
type ImportDecisions = Record<string, unknown>;
type ConfigImportMode = "apply" | "preview";

interface ConfigImportBody {
  kind?: unknown;
  text?: unknown;
  mode?: unknown;
  decisions?: unknown;
}

interface ApplyOutcome {
  created: number;
  updated: number;
  skipped: number;
}

interface BudgetApplyResult {
  status: "created" | "updated" | "skipped";
  id: string | null;
}

/** "2026-08" + 0 → "2026-08-01" style first-of-month date. */
function currentMonthFirst(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function applyBudgetRow(
  supabase: SupabaseClient,
  userId: string,
  row: BudgetImportRow,
  existing: { id: string; category: string } | undefined,
  decisionMap: ImportDecisions,
  month: string,
): Promise<BudgetApplyResult> {
  const decision = (decisionMap[row.category] as BudgetDecision | undefined) ?? "skip";
  if (decision === "skip") return { status: "skipped", id: null };
  const groupName = row.groupName ?? row.group;

  if (existing) {
    const { error } = await supabase
      .from("budgets")
      .update({
        monthly_limit: row.monthlyAmount,
        group_name: groupName,
      })
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (error) throw error;
    if (decision === "replace-month") {
      await writeMonthlyPlan(supabase, userId, row, month);
    }
    return { status: "updated", id: existing.id };
  }

  const { data, error } = await supabase
    .from("budgets")
    .insert({
      user_id: userId,
      category: row.category,
      monthly_limit: row.monthlyAmount,
      group_name: groupName,
      rollover_enabled: false,
      sort_order: 0,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (decision === "replace-month") {
    await writeMonthlyPlan(supabase, userId, row, month);
  }
  const id = (data as { id?: unknown } | null)?.id;
  return { status: "created", id: typeof id === "string" ? id : null };
}

async function applyBudgetImport(
  supabase: SupabaseClient,
  userId: string,
  rows: BudgetImportRow[],
  decisions: ImportDecisions,
): Promise<ApplyOutcome> {
  const { data: existingRows } = await supabase
    .from("budgets")
    .select("id, category, monthly_limit, group_name")
    .eq("user_id", userId);
  const existingByCategory = new Map(
    (existingRows ?? []).map((budget) => [budget.category.toLowerCase(), budget]),
  );

  const month = currentMonthFirst();
  let created = 0;
  let updated = 0;
  const changedIds: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const existing = existingByCategory.get(row.category.toLowerCase());
    const result = await applyBudgetRow(supabase, userId, row, existing, decisions, month);
    if (result.status === "created") {
      created += 1;
    } else if (result.status === "updated") {
      updated += 1;
    } else {
      skipped += 1;
    }
    if (result.id) changedIds.push(result.id);
  }

  if (created > 0 || updated > 0) {
    await writeAudit({
      userId,
      action: "budget_config_imported",
      metadata: {
        created_count: created,
        updated_count: updated,
        skipped_count: skipped,
        budget_ids: changedIds,
      },
    });
  }
  return { created, updated, skipped };
}

async function writeMonthlyPlan(
  supabase: SupabaseClient,
  userId: string,
  row: BudgetImportRow,
  month: string,
): Promise<void> {
  const { data: budget } = await supabase
    .from("budgets")
    .select("id")
    .eq("user_id", userId)
    .eq("category", row.category)
    .maybeSingle();
  if (!budget) return;
  const { error } = await supabase.from("budget_periods").upsert(
    {
      user_id: userId,
      budget_id: budget.id as string,
      month,
      planned: row.monthlyAmount,
    },
    { onConflict: "budget_id,month" },
  );
  if (error) throw error;
}

interface ExistingGoalRow {
  id: string;
  name: string;
  goal_type: string;
  target_amount: number | string;
  target_date: string | null;
  monthly_contribution: number | string | null;
  import_source: string | null;
  import_ref: string | null;
}

interface GoalAccountRow {
  id: string;
  name: string | null;
  type: string | null;
  current_balance: number | string | null;
}

interface GoalApplyResult {
  status: "created" | "updated" | "skipped";
  id: string | null;
  allocationId: string | null;
}

interface ResolvedGoalPlanRow {
  row: GoalImportPlanRow;
  match: ExistingGoalRow | null;
  decision: GoalImportDecision;
}

function validateGoalDecision(
  row: GoalImportPlanRow,
  match: ExistingGoalRow | null,
  decision: GoalImportDecision,
): string | null {
  if (!row.allowedDecisions.includes(decision)) {
    return `Decision ${String(decision)} is not allowed for ${row.decisionKey}`;
  }
  if (row.matchedGoalId && !match) return "Goal match changed before import could be applied";
  if (decision === "create" && row.targetAmount === null) {
    return "A positive target amount is required to create an imported goal";
  }
  if (row.providedFields.targetAmount && row.targetAmount === null) {
    return "Imported goal target amount must be positive";
  }
  return null;
}

function resolveGoalDecisions(
  plan: GoalImportPlan,
  existing: ExistingGoalRow[],
  decisionMap: ImportDecisions,
): { rows: ResolvedGoalPlanRow[] } | { error: string } {
  const planByKey = new Map(plan.rows.map((row) => [row.decisionKey, row]));
  for (const key of Object.keys(decisionMap)) {
    if (!planByKey.has(key)) return { error: "Invalid or stale goal decision key" };
  }

  const existingById = new Map(existing.map((goal) => [goal.id, goal]));
  const resolved: ResolvedGoalPlanRow[] = [];
  for (const row of plan.rows) {
    const requested = decisionMap[row.decisionKey];
    const decision = (requested ?? row.defaultDecision) as GoalImportDecision;
    const match = row.matchedGoalId ? existingById.get(row.matchedGoalId) ?? null : null;
    const error = validateGoalDecision(row, match, decision);
    if (error) return { error };
    resolved.push({ row, match, decision });
  }
  return { rows: resolved };
}

function hasGoalAllocation(row: GoalImportRow): boolean {
  return row.useEntireBalance || row.allocationAmount !== null;
}

function needsGoalAllocation(row: GoalImportRow): boolean {
  return Boolean(row.linkedAccountName && hasGoalAllocation(row));
}

function accountNameKey(name: string): string {
  return name.trim().toLowerCase();
}

async function captureImportedGoalBaseline(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
  row: GoalImportRow,
  account: GoalAccountRow,
): Promise<void> {
  if (row.goalType !== "pay_down" || !isLiabilityAccount(account.type)) return;
  const startingBalance = Number(account.current_balance ?? 0);
  if (!Number.isFinite(startingBalance)) return;
  const targetBalance = Math.max(
    0,
    Math.round((startingBalance - Number(row.targetAmount ?? 0)) * 100) / 100,
  );
  const { error } = await supabase
    .from("goals")
    .update({ starting_balance: startingBalance, target_balance: targetBalance })
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("starting_balance", null);
  if (error) throw error;
}

async function applyGoalAllocation(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
  row: GoalImportRow,
  account: GoalAccountRow,
): Promise<string | null> {
  if (!needsGoalAllocation(row)) return null;
  const { data, error } = await supabase.rpc("set_goal_allocation", {
    p_goal_id: goalId,
    p_account_id: account.id,
    p_allocated_amount: row.useEntireBalance ? null : row.allocationAmount,
    p_use_entire_balance: row.useEntireBalance,
  });
  if (error) throw error;
  await captureImportedGoalBaseline(supabase, userId, goalId, row, account);
  return typeof data === "string" ? data : null;
}

function goalAccountForRow(
  row: GoalImportRow,
  accountsByName: Map<string, GoalAccountRow>,
): GoalAccountRow | undefined {
  if (!row.linkedAccountName) return undefined;
  return accountsByName.get(accountNameKey(row.linkedAccountName));
}

async function updateGoalRow(
  supabase: SupabaseClient,
  userId: string,
  row: GoalImportPlanRow,
  match: ExistingGoalRow,
  decision: "merge" | "replace",
  account: GoalAccountRow | undefined,
): Promise<GoalApplyResult> {
  const values: Record<string, unknown> = {
    name: row.name,
    goal_type: row.goalType,
    import_source: row.importedId ? "monarch" : match.import_source,
    import_ref: row.importedId ?? match.import_ref,
  };
  if (decision === "replace") {
    values.target_amount = row.targetAmount ?? Number(match.target_amount);
    values.target_date = row.providedFields.targetDate ? row.targetDate : null;
    values.monthly_contribution = row.providedFields.monthlyContribution
      ? row.monthlyContribution
      : null;
  } else {
    if (row.providedFields.targetAmount) values.target_amount = row.targetAmount;
    if (row.providedFields.targetDate) values.target_date = row.targetDate;
    if (row.providedFields.monthlyContribution) {
      values.monthly_contribution = row.monthlyContribution;
    }
  }
  const { error } = await supabase
    .from("goals")
    .update(values)
    .eq("id", match.id)
    .eq("user_id", userId);
  if (error) throw error;
  const allocationId = account
    ? await applyGoalAllocation(supabase, userId, match.id, row, account)
    : null;
  return { status: "updated", id: match.id, allocationId };
}

async function createGoalRow(
  supabase: SupabaseClient,
  userId: string,
  row: GoalImportPlanRow,
  account: GoalAccountRow | undefined,
): Promise<GoalApplyResult> {
  const { data, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      name: row.name,
      goal_type: row.goalType,
      target_amount: row.targetAmount,
      target_date: row.targetDate,
      monthly_contribution: row.monthlyContribution,
      image_slug: null,
      spending_reduces: false,
      import_source: row.importedId ? "monarch" : null,
      import_ref: row.importedId,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  const id = (data as { id?: unknown } | null)?.id;
  if (needsGoalAllocation(row) && typeof id !== "string") {
    throw new Error("goal_import_created_without_id");
  }
  let allocationId: string | null = null;
  if (account && typeof id === "string") {
    allocationId = await applyGoalAllocation(supabase, userId, id, row, account);
  }
  return {
    status: "created",
    id: typeof id === "string" ? id : null,
    allocationId,
  };
}

async function applyGoalRow(
  supabase: SupabaseClient,
  userId: string,
  row: GoalImportPlanRow,
  match: ExistingGoalRow | null,
  decision: GoalImportDecision,
  accountsByName: Map<string, GoalAccountRow>,
): Promise<GoalApplyResult> {
  if (decision === "skip") return { status: "skipped", id: null, allocationId: null };
  const account = goalAccountForRow(row, accountsByName);
  if (needsGoalAllocation(row) && !account) {
    throw new Error(`goal_import_account_not_found:${row.linkedAccountName}`);
  }

  if (match) {
    if (decision !== "merge" && decision !== "replace") {
      throw new Error("goal_import_invalid_matched_decision");
    }
    return updateGoalRow(supabase, userId, row, match, decision, account);
  }
  if (decision !== "create") throw new Error("goal_import_invalid_unmatched_decision");
  return createGoalRow(supabase, userId, row, account);
}

async function applyGoalImport(
  supabase: SupabaseClient,
  userId: string,
  resolvedRows: ResolvedGoalPlanRow[],
  accountsByName: Map<string, GoalAccountRow>,
): Promise<ApplyOutcome> {
  let created = 0;
  let updated = 0;
  const changedIds: string[] = [];
  const allocationIds: string[] = [];
  let skipped = 0;

  for (const resolved of resolvedRows) {
    const { row, match, decision } = resolved;
    const result = await applyGoalRow(
      supabase,
      userId,
      row,
      match,
      decision,
      accountsByName,
    );
    if (result.status === "created") {
      created += 1;
    } else if (result.status === "updated") {
      updated += 1;
    } else {
      skipped += 1;
    }
    if (result.id) changedIds.push(result.id);
    if (result.allocationId) allocationIds.push(result.allocationId);
  }

  if (created > 0 || updated > 0) {
    await writeAudit({
      userId,
      action: "goal_config_imported",
      metadata: {
        created_count: created,
        updated_count: updated,
        skipped_count: skipped,
        goal_ids: changedIds,
        allocation_ids: allocationIds,
      },
    });
  }
  return { created, updated, skipped };
}

async function processBudgetConfig(
  supabase: SupabaseClient,
  userId: string,
  text: string,
  mode: ConfigImportMode,
  decisions: ImportDecisions,
): Promise<NextResponse> {
  const { rows, errors } = parseMonarchBudgets(text);
  if (errors.length > 0) return badRequest(errors[0] ?? "Invalid budget format");
  const { data: existing } = await supabase
    .from("budgets")
    .select("category, monthly_limit, group_name")
    .eq("user_id", userId);
  const plan = buildBudgetImportPlan(rows, existing ?? []);
  if (mode === "preview") return NextResponse.json({ kind: "budget", plan });
  const outcome = await applyBudgetImport(supabase, userId, rows, decisions);
  return NextResponse.json({ kind: "budget", ok: true, ...outcome });
}

function buildGoalAccountIndex(
  accountRows: unknown,
): { accountsByName: Map<string, GoalAccountRow>; duplicateNames: Set<string> } {
  const accountsByName = new Map<string, GoalAccountRow>();
  const duplicateNames = new Set<string>();
  for (const account of (accountRows ?? []) as GoalAccountRow[]) {
    if (!account.name) continue;
    const key = accountNameKey(account.name);
    if (accountsByName.has(key)) duplicateNames.add(key);
    accountsByName.set(key, account);
  }
  return { accountsByName, duplicateNames };
}

function validateGoalAllocations(
  rows: GoalImportRow[],
  accountsByName: Map<string, GoalAccountRow>,
  duplicateNames: Set<string>,
): NextResponse | null {
  for (const row of rows) {
    if (hasGoalAllocation(row) && !row.linkedAccountName) {
      return badRequest(`An account is required for goal allocation: ${row.name}`);
    }
    if (!needsGoalAllocation(row) || !row.linkedAccountName) continue;
    const key = accountNameKey(row.linkedAccountName);
    if (duplicateNames.has(key)) {
      return badRequest(`The linked account name is ambiguous: ${row.linkedAccountName}`);
    }
    if (!accountsByName.has(key)) {
      return badRequest(`Linked account not found: ${row.linkedAccountName}`);
    }
  }
  return null;
}

async function processGoalConfig(
  supabase: SupabaseClient,
  userId: string,
  text: string,
  mode: ConfigImportMode,
  decisions: ImportDecisions,
): Promise<NextResponse> {
  const { rows, errors } = parseMonarchGoals(text);
  if (errors.length > 0) return badRequest(errors[0] ?? "Invalid goal format");
  const { data: existing } = await supabase
    .from("goals")
    .select("id, name, goal_type, target_amount, target_date, monthly_contribution, import_source, import_ref")
    .eq("user_id", userId);
  const existingGoals = (existing ?? []) as ExistingGoalRow[];
  const plan = buildGoalImportPlan(rows, existingGoals);
  if (mode === "preview") return NextResponse.json({ kind: "goal", plan });
  const decisionResult = resolveGoalDecisions(plan, existingGoals, decisions);
  if ("error" in decisionResult) return badRequest(decisionResult.error);
  const activeRows = decisionResult.rows.filter(({ decision }) => decision !== "skip");
  const { data: accountRows, error: accountError } = await supabase
    .from("accounts")
    .select("id, name, type, current_balance")
    .eq("user_id", userId);
  if (accountError) throw accountError;
  const { accountsByName, duplicateNames } = buildGoalAccountIndex(accountRows);
  const allocationError = validateGoalAllocations(
    activeRows.map(({ row }) => row),
    accountsByName,
    duplicateNames,
  );
  if (allocationError) return allocationError;
  const outcome = await applyGoalImport(
    supabase,
    userId,
    decisionResult.rows,
    accountsByName,
  );
  return NextResponse.json({ kind: "goal", ok: true, ...outcome });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  if (!(await checkRateLimit(`import-config:${user.id}`, 10, 3600))) {
    return NextResponse.json({ error: "Too many configuration imports. Please wait a while." }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => null)) as ConfigImportBody | null;
    const kind = body?.kind;
    const text = body?.text;
    const mode: ConfigImportMode = body?.mode === "apply" ? "apply" : "preview";
    if (body?.decisions !== undefined && !isRecord(body.decisions)) {
      return badRequest("decisions must be an object");
    }
    const decisions = isRecord(body?.decisions) ? body.decisions : {};
    if (kind !== "budget" && kind !== "goal") return badRequest("kind must be budget or goal");
    if (typeof text !== "string" || text.length === 0 || text.length > 2 * 1024 * 1024) {
      return badRequest("text is required");
    }

    if (kind === "budget") {
      return processBudgetConfig(supabase, user.id, text, mode, decisions);
    }
    return processGoalConfig(supabase, user.id, text, mode, decisions);
  } catch (error) {
    return errorResponse("import.config", error);
  }
}
