import type { NextRequest } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    if (!isFeatureEnabled("compoundRules"))
      return Response.json({ error: "Not found" }, { status: 404 });
    if (
      !(await checkRateLimit(`rules:clear:${auth.user.id}`, 30, 3600, {
        failClosed: true,
      }))
    )
      return Response.json({ error: "Too many requests" }, { status: 429 });
    const body = await readJsonBody(req, 1024);
    if (body instanceof Response) return body;
    const value = body as { transactionId?: unknown } | null;
    if (
      !value ||
      typeof value.transactionId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.transactionId)
    )
      return badRequest("Invalid transaction id");
    const { data, error } = await auth.supabase
      .from("transaction_annotations")
      .select("updated_at")
      .eq("user_id", auth.user.id)
      .eq("transaction_id", value.transactionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    const result = await createServiceClient()
      .from("transaction_annotations")
      .update({ rule_actions: null, updated_at: new Date().toISOString() })
      .eq("user_id", auth.user.id)
      .eq("transaction_id", value.transactionId)
      .eq("updated_at", data.updated_at)
      .select("transaction_id")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      return Response.json(
        { error: "Transaction changed. Refresh and retry." },
        { status: 409 },
      );
    await writeAudit({
      userId: auth.user.id,
      action: "rule_effect_cleared",
      ip: getClientIp(req),
      metadata: { transaction_id: value.transactionId },
    });
    invalidateDashboardCache(auth.user.id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse("rules.effect.clear", error);
  }
}
