import { NextResponse, type NextRequest } from "next/server";
import { badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeRequestAudit } from "@/lib/request-audit";
import { isIsoDate } from "@/lib/reports";
import { withUser } from "@/lib/authed-route";

/**
 * The goal contribution ledger (Phase 7).
 *
 * Every row here is an event the user actually recorded. Account balance
 * movement is deliberately NOT written here — a balance can drift for a dozen
 * reasons that are not contributions, and Phase 4 reads this table to decide
 * what was actually contributed toward a goal in a month. Allocations against a
 * balance are a separate funding source (`goal_accounts`) precisely so the two
 * never get confused.
 *
 * Amounts are signed: a negative event is a withdrawal or a correction.
 */

const EVENT_TYPES = new Set(["manual_contribution", "manual_adjustment"]);
/** Guards a numeric(14,2) column against an absurd value. */
const MAX_EVENT_AMOUNT = 1_000_000_000;

export async function POST(request: NextRequest) {
  return withUser("goals.events.post", async ({ user, supabase }) => {
    if (!(await checkRateLimit(`goal-event:${user.id}`, 60, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as {
      goalId?: unknown;
      amount?: unknown;
      eventDate?: unknown;
      eventType?: unknown;
    } | null;

    const goalId =
      typeof body?.goalId === "string" && body.goalId.trim()
        ? body.goalId.trim()
        : null;
    if (!goalId) return badRequest("goalId is required");

    const amount = body?.amount;
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount === 0 ||
      Math.abs(amount) > MAX_EVENT_AMOUNT
    ) {
      return badRequest("amount must be a non-zero number");
    }

    // `transaction` events are created by the ledger editor, never posted here:
    // they carry a transaction_id whose ownership this route cannot vouch for.
    const eventType =
      typeof body?.eventType === "string" && EVENT_TYPES.has(body.eventType)
        ? body.eventType
        : "manual_contribution";

    const eventDate = body?.eventDate;
    const resolvedDate = isIsoDate(eventDate)
      ? eventDate
      : new Date().toISOString().slice(0, 10);

    const { data: goal } = await supabase
      .from("goals")
      .select("id")
      .eq("id", goalId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("goal_progress_events")
      .insert({
        user_id: user.id,
        goal_id: goalId,
        event_date: resolvedDate,
        amount: Math.round(amount * 100) / 100,
        event_type: eventType,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Ids and the kind of event only — never the amount.
    await writeRequestAudit(request, user.id, "goal_contribution_recorded", {
      goal_id: goalId,
      event_type: eventType,
    });

    return NextResponse.json({ ok: true, id: data.id });
  });
}

export async function DELETE(request: NextRequest) {
  return withUser("goals.events.delete", async ({ user, supabase }) => {
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) return badRequest("id is required");

    const { data, error } = await supabase
      .from("goal_progress_events")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    await writeRequestAudit(request, user.id, "goal_contribution_removed", { event_id: id });

    return NextResponse.json({ ok: true });
  });
}
