import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { getClientIp, writeAudit } from "@/lib/audit";
import { parseLifeEvent, type LifeEvent } from "@/lib/life-events";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRow(userId: string, event: LifeEvent) {
  return {
    user_id: userId,
    event_type: event.type,
    start_month: event.startMonth,
    amount: event.amount,
    duration_months: event.durationMonths,
    label: event.label ?? null,
  };
}

/**
 * Owner-scoped life-event CRUD for forecasting. Assumptions are explicit,
 * editable, and never a guarantee; every create/update/delete is audited.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const { data, error } = await supabase
      .from("life_events")
      .select("id, event_type, start_month, amount, duration_months, label")
      .eq("user_id", user.id)
      .order("start_month");
    if (error) throw error;
    return NextResponse.json({
      events: (data ?? []).map((row) => ({
        id: row.id,
        type: row.event_type,
        startMonth: row.start_month,
        amount: Number(row.amount),
        durationMonths: row.duration_months,
        label: row.label,
      })),
    });
  } catch (error) {
    return errorResponse("forecasting.life-events.list", error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = await request.json().catch(() => null);
    const parsed = parseLifeEvent(body);
    if (!parsed.ok) return badRequest(parsed.error);
    const { data, error } = await supabase
      .from("life_events")
      .insert(toRow(user.id, parsed.event))
      .select("id, event_type, start_month, amount, duration_months, label")
      .single();
    if (error) throw error;
    await writeAudit({
      userId: user.id,
      action: "life_event_created",
      metadata: { event_id: data.id, event_type: parsed.event.type, start_month: parsed.event.startMonth },
      ip: getClientIp(request),
    });
    return NextResponse.json({ event: { id: data.id, type: data.event_type, startMonth: data.start_month, amount: Number(data.amount), durationMonths: data.duration_months, label: data.label } }, { status: 201 });
  } catch (error) {
    return errorResponse("forecasting.life-events.create", error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = await request.json().catch(() => null);
    const eventId = (body as { id?: unknown } | null)?.id;
    if (typeof eventId !== "string" || !UUID_REGEX.test(eventId)) {
      return badRequest("Invalid event id");
    }
    const parsed = parseLifeEvent(body);
    if (!parsed.ok) return badRequest(parsed.error);
    const { data, error } = await supabase
      .from("life_events")
      .update(toRow(user.id, parsed.event))
      .eq("id", eventId)
      .eq("user_id", user.id)
      .select("id, event_type, start_month, amount, duration_months, label")
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest("Life event not found");
    await writeAudit({
      userId: user.id,
      action: "life_event_updated",
      metadata: { event_id: eventId, event_type: parsed.event.type },
      ip: getClientIp(request),
    });
    return NextResponse.json({ event: { id: data.id, type: data.event_type, startMonth: data.start_month, amount: Number(data.amount), durationMonths: data.duration_months, label: data.label } });
  } catch (error) {
    return errorResponse("forecasting.life-events.update", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = await request.json().catch(() => null);
    const eventId = (body as { id?: unknown } | null)?.id;
    if (typeof eventId !== "string" || !UUID_REGEX.test(eventId)) {
      return badRequest("Invalid event id");
    }
    const { data, error } = await supabase
      .from("life_events")
      .delete()
      .eq("id", eventId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest("Life event not found");
    await writeAudit({
      userId: user.id,
      action: "life_event_deleted",
      metadata: { event_id: eventId },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("forecasting.life-events.delete", error);
  }
}
