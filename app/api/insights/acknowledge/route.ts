import type { NextRequest } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    if (!isFeatureEnabled("insightsFeed"))
      return Response.json({ error: "Not found" }, { status: 404 });
    if (
      !(await checkRateLimit(`insights:ack:${auth.user.id}`, 60, 3600, {
        failClosed: true,
      }))
    )
      return Response.json({ error: "Too many requests" }, { status: 429 });
    const body = await readJsonBody(req, 1024);
    if (body instanceof Response) return body;
    const value = body as { id?: unknown; action?: unknown } | null;
    if (
      !value ||
      typeof value.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.id) ||
      !["acknowledge", "restore"].includes(String(value.action))
    )
      return badRequest(
        "A notification id and acknowledge or restore action are required",
      );
    const readAt =
      value.action === "acknowledge" ? new Date().toISOString() : null;
    const { data, error } = await auth.supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("user_id", auth.user.id)
      .eq("id", value.id)
      .select("id,read_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    await writeAudit({
      userId: auth.user.id,
      action:
        value.action === "acknowledge"
          ? "insight_acknowledged"
          : "insight_restored",
      ip: getClientIp(req),
      metadata: { notification_id: value.id },
    });
    return Response.json(data);
  } catch (error) {
    return errorResponse("insights.acknowledge", error);
  }
}
