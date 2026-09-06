import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("enabled" in body) || typeof body.enabled !== "boolean") {
      return badRequest("enabled must be a boolean");
    }
    if (!await checkRateLimit(`ai-consent:${auth.user.id}`, 20, 3600, { failClosed: true })) {
      return NextResponse.json({ error: "Unable to save right now. Please try again later." }, { status: 429 });
    }
    const { error } = await auth.supabase.from("ai_settings").upsert(
      { user_id: auth.user.id, enabled: body.enabled },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    await writeAudit({
      userId: auth.user.id,
      action: "ai_consent_updated",
      metadata: { enabled: body.enabled },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (error) {
    return errorResponse("settings.ai.patch", error);
  }
}
