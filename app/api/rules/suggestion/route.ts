import type { NextRequest } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    if (
      !isFeatureEnabled("ruleSuggestions") ||
      !isFeatureEnabled("compoundRules")
    )
      return Response.json({ error: "Not found" }, { status: 404 });
    if (
      !(await checkRateLimit(`rules:suggest:${auth.user.id}`, 60, 3600, {
        failClosed: true,
      }))
    )
      return Response.json({ error: "Too many requests" }, { status: 429 });
    const id = req.nextUrl.searchParams.get("id");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id))
      return badRequest("Invalid transaction id");
    const { data, error } = await auth.supabase
      .from("transactions")
      .select("id,merchant_name,name,amount,account_id,manual_account_id")
      .eq("user_id", auth.user.id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({
      merchant: data.merchant_name ?? data.name,
      name: data.name,
      amount: Math.abs(Number(data.amount)),
      accountId: data.account_id ?? data.manual_account_id,
    });
  } catch (error) {
    return errorResponse("rules.suggestion", error);
  }
}
