import { NextResponse, type NextRequest } from "next/server";
import { buildSessionList } from "@/lib/security-account";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const { data, error } = await supabase
      .from("user_session_records")
      .select("id, session_id, user_agent, revoked_at, last_seen_at")
      .is("revoked_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    return NextResponse.json({
      sessions: buildSessionList(
        (data ?? []).map((row) => ({
          id: row.id as string,
          current: false,
          userAgent: row.user_agent as string | null,
          lastSeenAt: row.last_seen_at as string,
        })),
      ),
    });
  } catch (error) {
    return errorResponse("settings.sessions", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const body = await request.json().catch(() => null);
    const sessionId = body?.session_id;
    if (typeof sessionId !== "string") return badRequest("session_id is required");

    const service = createServiceClient();
    const { error } = await service
      .from("user_session_records")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("id", sessionId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("settings.sessions.delete", error);
  }
}
