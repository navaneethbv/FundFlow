import { NextRequest, NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { writeAudit, getClientIp } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type OverrideState = { displayCategory: string | null; cashFlowClassification: "expense" | "income" | null };

function parseState(value: unknown): OverrideState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { displayCategory?: unknown; cashFlowClassification?: unknown };
  const displayCategory = row.displayCategory === null ? null : typeof row.displayCategory === "string" ? row.displayCategory.slice(0, 100) : undefined;
  const classification = row.cashFlowClassification;
  const cashFlowClassification = classification === null || classification === "expense" || classification === "income" ? classification : undefined;
  return displayCategory !== undefined && cashFlowClassification !== undefined ? { displayCategory, cashFlowClassification } : null;
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("undoToasts")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = (await request.json().catch(() => null)) as { transaction_id?: unknown; expected?: unknown; restore?: unknown } | null;
    if (typeof body?.transaction_id !== "string" || !UUID.test(body.transaction_id)) return badRequest("Invalid transaction_id");
    const expected = parseState(body.expected);
    const restore = parseState(body.restore);
    if (!expected || !restore) return badRequest("Invalid override state");
    const { data: transaction, error: transactionError } = await supabase.from("transactions").select("id").eq("id", body.transaction_id).eq("user_id", user.id).maybeSingle();
    if (transactionError) throw transactionError;
    if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    const { data: current, error: currentError } = await supabase.from("transaction_annotations").select("display_category,cash_flow_classification").eq("user_id", user.id).eq("transaction_id", body.transaction_id).maybeSingle();
    if (currentError) throw currentError;
    const currentState: OverrideState = { displayCategory: current?.display_category ?? null, cashFlowClassification: current?.cash_flow_classification ?? null };
    if (JSON.stringify(currentState) !== JSON.stringify(expected)) return NextResponse.json({ error: "This transaction changed; undo was not applied." }, { status: 409 });
    const { error } = await supabase.from("transaction_annotations").upsert({ user_id: user.id, transaction_id: body.transaction_id, display_category: restore.displayCategory, cash_flow_classification: restore.cashFlowClassification }, { onConflict: "user_id,transaction_id" });
    if (error) throw error;
    invalidateDashboardCache(user.id);
    await writeAudit({ userId: user.id, action: "transaction_override_undone", metadata: { transaction_id: body.transaction_id }, ip: getClientIp(request) });
    return NextResponse.json({ undone: true });
  } catch (error) {
    return errorResponse("transactions.undo-override", error);
  }
}
