import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { getClientIp, writeAudit } from "@/lib/audit";
import { planTemplateApply } from "@/lib/budget-template";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YYYY_MM_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const RPC_CONCURRENCY = 10;

interface TemplateItemsRow {
  items: unknown;
}

async function applyPlanToPeriods(
  supabase: ReturnType<typeof requireUser> extends Promise<infer R> ? (R extends { supabase: infer S } ? S : never) : never,
  rows: readonly { budgetId: string; planned: number }[],
  monthDate: string,
): Promise<{ error?: unknown; applied: number }> {
  let applied = 0;
  for (let index = 0; index < rows.length; index += RPC_CONCURRENCY) {
    const lane = rows.slice(index, index + RPC_CONCURRENCY);
    const results = await Promise.all(
      lane.map((row) =>
        (supabase as unknown as { rpc: (fn: string, params: unknown) => Promise<{ error: unknown }> }).rpc(
          "update_budget_period",
          {
            p_budget_id: row.budgetId,
            p_month: monthDate,
            p_planned: row.planned,
            p_group_name: null,
            p_rollover_enabled: null,
            p_sort_order: null,
          },
        ),
      ),
    );
    const failure = results.find(({ error }) => error);
    if (failure?.error) return { error: failure.error, applied };
    applied += lane.length;
  }
  return { applied };
}

interface ApplyParams {
  templateId: string;
  month: string;
  mode?: "merge" | "overwrite";
}

function parseApplyParams(body: Record<string, unknown> | null): { ok: true; params: ApplyParams } | { ok: false; response: NextResponse } {
  const templateId = typeof body?.template_id === "string" ? body.template_id : "";
  const month = typeof body?.month === "string" ? body.month : "";
  const mode = body?.mode === "merge" || body?.mode === "overwrite" ? body.mode : undefined;
  if (!UUID_REGEX.test(templateId)) return { ok: false, response: badRequest("Invalid template id") };
  if (!YYYY_MM_REGEX.test(month)) return { ok: false, response: badRequest("Invalid month") };
  return { ok: true, params: { templateId, month, mode } };
}

async function prepareApplyPlan(
  supabase: ReturnType<typeof requireUser> extends Promise<infer R> ? (R extends { supabase: infer S } ? S : never) : never,
  userId: string,
  params: ApplyParams,
) {
  const { data: template, error: templateError } = await (supabase as unknown as { from: (table: string) => { select: (cols: string) => { eq: (col: string, val: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: TemplateItemsRow | null; error: unknown }> } } } } }).from("budget_templates")
    .select("items")
    .eq("id", params.templateId)
    .eq("user_id", userId)
    .maybeSingle();
  if (templateError) return { ok: false as const, error: templateError };
  if (!template) return { ok: false as const, notFound: true };

  const { data: budgetRows, error: budgetsError } = await (supabase as unknown as { from: (table: string) => { select: (cols: string) => { eq: (col: string, val: string) => { limit: (n: number) => Promise<{ data: Array<{ id: string; category: string }> | null; error: unknown }> } } } }).from("budgets")
    .select("id, category")
    .eq("user_id", userId)
    .limit(5000);
  if (budgetsError) return { ok: false as const, error: budgetsError };

  const budgetIds = (budgetRows ?? []).map((row) => row.id);
  const { data: existingRows, error: existingError } = budgetIds.length
    ? await (supabase as unknown as { from: (table: string) => { select: (cols: string) => { eq: (col: string, val: string) => { in: (col: string, ids: string[]) => Promise<{ data: Array<{ budget_id: string }> | null; error: unknown }> } } } }).from("budget_periods")
        .select("budget_id")
        .eq("month", `${params.month}-01`)
        .in("budget_id", budgetIds)
    : { data: [] as Array<{ budget_id: string }>, error: null };
  if (existingError) return { ok: false as const, error: existingError };

  const plan = planTemplateApply(
    template.items as never,
    budgetRows ?? [],
    existingRows ?? [],
    params.mode,
  );
  return { ok: true as const, plan };
}

/**
 * Apply a saved template to a month: upsert the template's planned amounts
 * onto the user's matching `budgets` rows via `update_budget_period`.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = parseApplyParams(body);
    if (!parsed.ok) return parsed.response;
    const { params } = parsed;

    const prepared = await prepareApplyPlan(supabase as never, user.id, params);
    if (!prepared.ok) {
      if (prepared.error) return errorResponse("budget.templates.apply.read", prepared.error);
      return badRequest("Template not found");
    }
    const { plan } = prepared;

    if (plan.conflicts > 0 && !params.mode) {
      return NextResponse.json(
        {
          error: "month_not_empty",
          existing_count: plan.conflicts,
          source_count: plan.rows.length + plan.skipped,
        },
        { status: 409 },
      );
    }

    const { error: applyError, applied } = await applyPlanToPeriods(
      supabase as never,
      plan.rows,
      `${params.month}-01`,
    );
    if (applyError) return errorResponse("budget.templates.apply.write", applyError);

    if (applied > 0) {
      await writeAudit({
        userId: user.id,
        action: "budget_template_applied",
        metadata: {
          template_id: params.templateId,
          month: `${params.month}-01`,
          mode: plan.conflicts > 0 ? params.mode : "create",
          applied_count: applied,
          unmatched_categories: plan.unmatched,
        },
        ip: getClientIp(request),
      });
    }

    return NextResponse.json({
      applied,
      skipped_existing: plan.skipped,
      unmatched: plan.unmatched,
    });
  } catch (error) {
    return errorResponse("budget.templates.apply", error);
  }
}
