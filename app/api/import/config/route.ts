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
  matchGoal,
  type GoalImportRow,
} from "@/lib/goal-import";
import { checkRateLimit } from "@/lib/rate-limit";

type BudgetDecision = "merge" | "replace-month" | "skip";
type GoalDecision = "create" | "merge" | "skip" | "replace";

interface ApplyOutcome {
  created: number;
  updated: number;
  skipped: number;
}

/** "2026-08" + 0 → "2026-08-01" style first-of-month date. */
function currentMonthFirst(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function applyBudgetImport(
  supabase: SupabaseClient,
  userId: string,
  rows: BudgetImportRow[],
  decisions: Record<string, BudgetDecision | undefined>,
): Promise<ApplyOutcome> {
  const { data: existingRows } = await supabase
    .from("budgets")
    .select("id, category, monthly_limit, group_name")
    .eq("user_id", userId);
  const existingByCategory = new Map(
    (existingRows ?? []).map((budget) => [budget.category.toLowerCase(), budget]),
  );

  const month = currentMonthFirst();
  const created: string[] = [];
  const updated: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const decision = decisions[row.category] ?? "skip";
    const existing = existingByCategory.get(row.category.toLowerCase());
    if (!existing) {
      if (decision === "skip") {
        skipped += 1;
        continue;
      }
      const { error } = await supabase.from("budgets").insert({
        user_id: userId,
        category: row.category,
        monthly_limit: row.monthlyAmount,
        group_name: row.group,
        rollover_enabled: false,
        sort_order: 0,
      });
      if (error) throw error;
      created.push(row.category);
      if (decision === "replace-month") {
        await writeMonthlyPlan(supabase, userId, row, month);
      }
      continue;
    }
    if (decision === "skip") {
      skipped += 1;
      continue;
    }
    const { error } = await supabase
      .from("budgets")
      .update({
        monthly_limit: row.monthlyAmount,
        group_name: row.group,
      })
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (error) throw error;
    updated.push(existing.category as string);
    if (decision === "replace-month") {
      await writeMonthlyPlan(supabase, userId, row, month);
    }
  }

  if (created.length > 0 || updated.length > 0) {
    await writeAudit({
      userId,
      action: "budget_config_imported",
      metadata: {
        created,
        updated,
        skipped,
        mode: decisions,
      },
    });
  }
  return { created: created.length, updated: updated.length, skipped };
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

async function applyGoalImport(
  supabase: SupabaseClient,
  userId: string,
  rows: GoalImportRow[],
  decisions: Record<string, GoalDecision | undefined>,
): Promise<ApplyOutcome> {
  const { data: existingRows } = await supabase
    .from("goals")
    .select("id, name, goal_type, target_amount, target_date, import_source, import_ref")
    .eq("user_id", userId);
  const existing = (existingRows ?? []) as Array<{
    id: string;
    name: string;
    goal_type: string;
    target_amount: number | string;
    target_date: string | null;
    import_source: string | null;
    import_ref: string | null;
  }>;

  const created: string[] = [];
  const updated: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const decision = decisions[row.name] ?? "skip";
    const match = matchGoal(row, existing);
    if (!match) {
      if (decision === "skip") {
        skipped += 1;
        continue;
      }
      const { error } = await supabase.from("goals").insert({
        user_id: userId,
        name: row.name,
        goal_type: row.goalType,
        target_amount: row.targetAmount ?? 1,
        target_date: row.targetDate,
        monthly_contribution: row.monthlyContribution,
        image_slug: null,
        spending_reduces: false,
        import_source: row.importedId ? "monarch" : null,
        import_ref: row.importedId,
      });
      if (error) throw error;
      created.push(row.name);
      continue;
    }
    if (decision === "skip") {
      skipped += 1;
      continue;
    }
    const { error } = await supabase
      .from("goals")
      .update({
        name: row.name,
        goal_type: row.goalType,
        target_amount: row.targetAmount ?? Number(match.target_amount),
        target_date: row.targetDate ?? match.target_date,
        monthly_contribution: row.monthlyContribution ?? undefined,
        import_source: row.importedId ? "monarch" : match.import_source,
        import_ref: row.importedId ?? match.import_ref,
      })
      .eq("id", match.id)
      .eq("user_id", userId);
    if (error) throw error;
    updated.push(match.name);
  }

  if (created.length > 0 || updated.length > 0) {
    await writeAudit({
      userId,
      action: "goal_config_imported",
      metadata: {
        created,
        updated,
        skipped,
        mode: decisions,
      },
    });
  }
  return { created: created.length, updated: updated.length, skipped };
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  if (!(await checkRateLimit(`import-config:${user.id}`, 10, 3600))) {
    return NextResponse.json({ error: "Too many configuration imports. Please wait a while." }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => null);
    const kind = body?.kind;
    const text = body?.text;
    const mode = body?.mode === "apply" ? "apply" : "preview";
    const decisions = body?.decisions && typeof body.decisions === "object" ? body.decisions : {};
    if (kind !== "budget" && kind !== "goal") return badRequest("kind must be budget or goal");
    if (typeof text !== "string" || text.length === 0 || text.length > 2 * 1024 * 1024) {
      return badRequest("text is required");
    }

    if (kind === "budget") {
      const { rows, errors } = parseMonarchBudgets(text);
      if (errors.length > 0) return badRequest(errors[0] ?? "Invalid budget format");
      const { data: existing } = await supabase
        .from("budgets")
        .select("category, monthly_limit, group_name")
        .eq("user_id", user.id);
      const plan = buildBudgetImportPlan(rows, existing ?? []);
      if (mode === "preview") return NextResponse.json({ kind, plan });
      const outcome = await applyBudgetImport(supabase, user.id, rows, decisions);
      return NextResponse.json({ kind, ok: true, ...outcome });
    }

    const { rows, errors } = parseMonarchGoals(text);
    if (errors.length > 0) return badRequest(errors[0] ?? "Invalid goal format");
    const { data: existing } = await supabase
      .from("goals")
      .select("id, name, goal_type, target_amount, target_date, import_source, import_ref")
      .eq("user_id", user.id);
    const plan = buildGoalImportPlan(rows, existing ?? []);
    if (mode === "preview") return NextResponse.json({ kind, plan });
    const outcome = await applyGoalImport(supabase, user.id, rows, decisions);
    return NextResponse.json({ kind, ok: true, ...outcome });
  } catch (error) {
    return errorResponse("import.config", error);
  }
}