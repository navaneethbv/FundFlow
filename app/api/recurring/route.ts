import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { requireUser, badRequest, errorResponse } from "@/lib/http";

// Existing PATCH handler (unchanged)
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { stream_id, action, user_amount } = body;

    if (!stream_id || !action) {
      return NextResponse.json({ error: "Missing stream_id or action" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if (action === "review") {
      updates.reviewed_at = new Date().toISOString();
      updates.dismissed_at = null;
    } else if (action === "dismiss") {
      updates.dismissed_at = new Date().toISOString();
    } else if (action === "restore") {
      updates.dismissed_at = null;
      updates.reviewed_at = new Date().toISOString();
    } else if (action === "amount" && user_amount !== undefined) {
      updates.user_amount = Number(user_amount);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const { error } = await supabase
      .from("recurring_streams")
      .update(updates)
      .eq("id", stream_id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAudit({
      userId: user.id,
      action: "data_refresh",
      metadata: { stream_id, action },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update stream";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// New GET endpoint – returns all recurring streams for the authenticated user
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  const { data, error } = await supabase
    .from("recurring_streams")
    .select("id, stream_id, stream_type, description, merchant_name, average_amount, last_amount, frequency, status, category, is_active, reviewed_at, dismissed_at, user_amount")
    .eq("user_id", user.id);

  if (error) {
    return errorResponse("recurring.fetch", error);
  }

  return NextResponse.json({ streams: data ?? [] });
}

// Placeholder POST – future manual recurring CRUD (not yet implemented)
export async function POST() {
  return badRequest("POST not implemented for recurring streams");
}
