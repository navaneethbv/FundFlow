import type { NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    if (!isFeatureEnabled("ruleRunHistory"))
      return Response.json({ error: "Not found" }, { status: 404 });
    const transactionId = req.nextUrl.searchParams.get("transactionId");
    if (transactionId) {
      if (!/^[0-9a-f-]{36}$/i.test(transactionId))
        return badRequest("Invalid transaction id");
      const result = await auth.supabase
        .from("rule_changes")
        .select("id,created_at,rule_runs(rule_id)")
        .eq("user_id", auth.user.id)
        .eq("transaction_id", transactionId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (result.error) throw result.error;
      return Response.json({ changes: result.data ?? [] });
    }
    const { data, error } = await auth.supabase
      .from("rule_runs")
      .select(
        "id,rule_id,trigger,matched,changed,status,error,created_at,completed_at",
      )
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ runs: data ?? [] });
  } catch (error) {
    return errorResponse("rules.history", error);
  }
}
