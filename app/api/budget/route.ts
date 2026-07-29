import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YYYY_MM_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export async function PUT(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return badRequest("Invalid JSON payload");
    }

    const { budget_id, month, planned, group_name, rollover_enabled } = body;

    if (!budget_id || typeof budget_id !== "string" || !UUID_REGEX.test(budget_id)) {
      return badRequest("Invalid budget_id");
    }

    if (!month || typeof month !== "string" || !YYYY_MM_REGEX.test(month.slice(0, 7))) {
      return badRequest("Invalid month");
    }

    const parsedPlanned = Number(planned);
    if (!Number.isFinite(parsedPlanned) || parsedPlanned < 0) {
      return badRequest("Invalid planned amount");
    }

    const firstOfMonth = `${month.slice(0, 7)}-01`;

    const { error: periodError } = await supabase
      .from("budget_periods")
      .upsert(
        {
          user_id: user.id,
          budget_id,
          month: firstOfMonth,
          planned: Math.round(parsedPlanned * 100) / 100,
        },
        { onConflict: "budget_id,month" },
      );

    if (periodError) {
      return errorResponse("budget.update_period", periodError);
    }

    const changedFields: string[] = ["planned"];

    if (group_name !== undefined || rollover_enabled !== undefined) {
      const updateData: Record<string, unknown> = {};
      if (group_name) {
        if (!["income", "fixed", "flexible", "non_monthly"].includes(group_name)) {
          return badRequest("Invalid group_name");
        }
        updateData.group_name = group_name;
        changedFields.push("group_name");
      }
      if (rollover_enabled !== undefined) {
        updateData.rollover_enabled = Boolean(rollover_enabled);
        changedFields.push("rollover_enabled");
      }

      const { error: budgetError } = await supabase
        .from("budgets")
        .update(updateData)
        .eq("id", budget_id)
        .eq("user_id", user.id);

      if (budgetError) {
        return errorResponse("budget.update_envelope", budgetError);
      }
    }

    await writeAudit({
      userId: user.id,
      action: "budget_updated",
      metadata: { budget_id, month: firstOfMonth, changed_fields: changedFields },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("budget.update", error);
  }
}
