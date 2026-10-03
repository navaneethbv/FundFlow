import type { NextRequest } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { INSIGHT_TYPES } from "@/lib/insight-types";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    if (!isFeatureEnabled("insightGenerators"))
      return Response.json({ error: "Not found" }, { status: 404 });
    if (
      !(await checkRateLimit(`insights:prefs:${auth.user.id}`, 30, 3600, {
        failClosed: true,
      }))
    )
      return Response.json({ error: "Too many requests" }, { status: 429 });
    const body = await readJsonBody(req, 2048);
    if (body instanceof Response) return body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return badRequest("Expected preference fields");
    const values = Object.entries(body);
    if (
      !values.length ||
      values.some(
        ([key, value]) =>
          !(INSIGHT_TYPES as readonly string[]).includes(key) ||
          typeof value !== "boolean",
      )
    )
      return badRequest("Unknown preference or non-boolean value");
    const { error } = await auth.supabase
      .from("alert_preferences")
      .upsert(
        { ...Object.fromEntries(values), user_id: auth.user.id },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    await writeAudit({
      userId: auth.user.id,
      action: "insight_preferences_updated",
      ip: getClientIp(req),
      metadata: { fields: values.map(([key]) => key) },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse("insights.preferences", error);
  }
}
