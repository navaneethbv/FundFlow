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

/**
 * Apply a saved template to a month: upsert the template's planned amounts
 * onto the user's matching `budgets` rows via `update_budget_period`, with
 * the same conflict rule as copy-last-month — a month that already has
 * envelopes answers 409 until the client sends an explicit `mode`
 * ("merge" fills empty envelopes, "overwrite" restates them). Nothing is
 * silently replaced.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const templateId = typeof body?.template_id === "string" ? body.template_id : "";
    const month = typeof body?.month === "string" ? body.month : "";
    const mode =
      body?.mode === "merge" || body?.mode === "overwrite" ? body.mode : undefined;
    if (!UUID_REGEX.test(templateId)) return badRequest("Invalid template id");
    if (!YYYY_MM_REGEX.test(month)) return badRequest("Invalid month");

    const { data: template, error: templateError } = await supabase
      .from("budget_templates")
      .select("items")
      .eq("id", templateId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (templateError) return errorResponse("budget.templates.apply.read", templateError);
    if (!template) return badRequest("Template not found");

    const { data: budgetRows, error: budgetsError } = await supabase
      .from("budgets")
      .select("id, category")
      .eq("user_id", user.id)
      .limit(5000);
    if (budgetsError) return errorResponse("budget.templates.apply.read", budgetsError);

    const budgetIds = ((budgetRows ?? []) as Array<{ id: string }>).map((row) => row.id);
    const { data: existingRows, error: existingError } = budgetIds.length
      ? await supabase
          .from("budget_periods")
          .select("budget_id")
          .eq("month", `${month}-01`)
          .in("budget_id", budgetIds)
      : { data: [] as never[], error: null };
    if (existingError) return errorResponse("budget.templates.apply.read", existingError);

    const plan = planTemplateApply(
      (template as TemplateItemsRow).items as never,
      (budgetRows ?? []) as Array<{ id: string; category: string }>,
      (existingRows ?? []) as Array<{ budget_id: string }>,
      mode,
    );

    if (plan.conflicts > 0 && !mode) {
      return NextResponse.json(
        {
          error: "month_not_empty",
          existing_count: plan.conflicts,
          source_count: plan.rows.length + plan.skipped,
        },
        { status: 409 },
      );
    }

    let applied = 0;
    for (let index = 0; index < plan.rows.length; index += RPC_CONCURRENCY) {
      const lane = plan.rows.slice(index, index + RPC_CONCURRENCY);
      const results = await Promise.all(
        lane.map((row) =>
          supabase.rpc("update_budget_period", {
            p_budget_id: row.budgetId,
            p_month: `${month}-01`,
            p_planned: row.planned,
            p_group_name: null,
            p_rollover_enabled: null,
            p_sort_order: null,
          }),
        ),
      );
      const failure = results.find(({ error }) => error);
      if (failure?.error) return errorResponse("budget.templates.apply.write", failure.error);
      applied += lane.length;
    }

    if (applied > 0) {
      await writeAudit({
        userId: user.id,
        action: "budget_template_applied",
        metadata: {
          template_id: templateId,
          month: `${month}-01`,
          mode: plan.conflicts > 0 ? mode : "create",
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
