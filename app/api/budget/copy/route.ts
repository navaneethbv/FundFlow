import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import {
  parseCopyBody,
  planCopy,
  previousMonth,
} from "@/lib/budget-copy";

/**
 * "Copy last month's budget": upsert the previous month's `budget_periods`
 * planned amounts into the requested month, keyed by the same month-agnostic
 * `budgets` rows (rollover/group/category are untouched — the RPC's
 * non-planned fields stay null, exactly like the per-row PUT).
 *
 * Conflict rule: when the target month already has envelopes, a bare request
 * answers 409 with the counts and the client must come back with an explicit
 * `mode` — `merge` fills only empty envelopes, `overwrite` restates every
 * source value after the user confirms. Nothing is ever silently replaced.
 */

const MAX_BUDGETS = 5000;
/** Parallel lanes for the per-row RPC; bounded so a wide plan can't fan out. */
const RPC_CONCURRENCY = 10;

interface PeriodRead {
  budget_id: string;
  planned: number | string;
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const parsed = parseCopyBody(await request.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.message);
    const { month, mode } = parsed;
    const firstOfMonth = `${month}-01`;
    const fromFirstOfMonth = `${previousMonth(month)}-01`;

    const { data: budgetRows, error: budgetError } = await supabase
      .from("budgets")
      .select("id")
      .eq("user_id", user.id)
      .limit(MAX_BUDGETS);
    if (budgetError) return errorResponse("budget.copy.read", budgetError);
    const budgetIds = (budgetRows ?? []).map((row) => row.id as string);
    if (budgetIds.length === 0) {
      return NextResponse.json({
        copied: 0,
        skipped_existing: 0,
        source_count: 0,
      });
    }

    const readPeriods = async (target: string) => {
      const { data, error } = await supabase
        .from("budget_periods")
        .select("budget_id, planned")
        .in("budget_id", budgetIds)
        .eq("month", target);
      if (error) return { error };
      return { rows: (data ?? []) as PeriodRead[] };
    };

    const [source, existing] = await Promise.all([
      readPeriods(fromFirstOfMonth),
      readPeriods(firstOfMonth),
    ]);
    if (source.error) return errorResponse("budget.copy.read", source.error);
    if (existing.error) return errorResponse("budget.copy.read", existing.error);

    if (existing.rows.length > 0 && !mode) {
      return NextResponse.json(
        {
          error: "month_not_empty",
          existing_count: existing.rows.length,
          source_count: source.rows.length,
        },
        { status: 409 },
      );
    }

    const plan = planCopy(source.rows, existing.rows, mode);

    let copied = 0;
    for (let index = 0; index < plan.rows.length; index += RPC_CONCURRENCY) {
      const lane = plan.rows.slice(index, index + RPC_CONCURRENCY);
      const results = await Promise.all(
        lane.map((row) =>
          supabase.rpc("update_budget_period", {
            p_budget_id: row.budgetId,
            p_month: firstOfMonth,
            p_planned: row.planned,
            p_group_name: null,
            p_rollover_enabled: null,
            p_sort_order: null,
          }),
        ),
      );
      const failure = results.find(({ error }) => error);
      if (failure?.error) return errorResponse("budget.copy.write", failure.error);
      copied += lane.length;
    }

    if (copied > 0) {
      await writeAudit({
        userId: user.id,
        action: "budget_copied",
        metadata: {
          month: firstOfMonth,
          from_month: fromFirstOfMonth,
          mode: existing.rows.length > 0 ? mode : "create",
          copied_count: copied,
          skipped_existing: plan.skipped,
        },
      });
    }

    return NextResponse.json({
      copied,
      skipped_existing: plan.skipped,
      source_count: source.rows.length,
    });
  } catch (error) {
    return errorResponse("budget.copy", error);
  }
}
