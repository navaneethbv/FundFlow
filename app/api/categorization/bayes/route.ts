import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { trainLocalBayes, type CategorizationRow } from "@/lib/bayes-categorizer";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("bayesCategorization")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!(await checkRateLimit(`categorization:bayes:${auth.user.id}`, 5, 3600))) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const { data: transactions, error: transactionError } = await auth.supabase
      .from("transactions")
      .select("id,merchant_name,name,pfc_primary")
      .eq("user_id", auth.user.id)
      .order("date", { ascending: false })
      .limit(5000);
    if (transactionError) throw transactionError;
    const { data: annotations, error: annotationError } = await auth.supabase
      .from("transaction_annotations")
      .select("transaction_id,display_category")
      .eq("user_id", auth.user.id);
    if (annotationError) throw annotationError;
    const overrides = new Map((annotations ?? []).map((row) => [row.transaction_id as string, row.display_category as string | null]));
    const rows: CategorizationRow[] = (transactions ?? []).map((row) => ({
      id: row.id as string,
      merchant: row.merchant_name as string | null,
      name: row.name as string | null,
      category: overrides.get(row.id as string) ?? row.pfc_primary as string | null,
    }));
    const result = trainLocalBayes(rows);
    if (!result.eligible || result.suggestions.length === 0) return NextResponse.json(result);
    const writes = result.suggestions.map((suggestion) => ({
      user_id: auth.user.id,
      transaction_id: suggestion.transactionId,
      display_category: suggestion.category,
      classification_source: "bayes" as const,
    }));
    const { error: writeError } = await auth.supabase.from("transaction_annotations").upsert(writes, { onConflict: "user_id,transaction_id", defaultToNull: false });
    if (writeError) throw writeError;
    await writeAudit({ userId: auth.user.id, action: "bayes_categorization_applied", metadata: { count: writes.length }, ip: getClientIp(request) });
    return NextResponse.json({ ...result, applied: writes.length });
  } catch (error) {
    return errorResponse("categorization.bayes", error);
  }
}
