import { NextRequest, NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { writeAudit, getClientIp } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AnnotationState = { note: string; tags: string[]; cleared: boolean };

function parseState(value: unknown): AnnotationState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { note?: unknown; tags?: unknown; cleared?: unknown };
  if (typeof row.note !== "string" || !Array.isArray(row.tags) || typeof row.cleared !== "boolean") return null;
  if (!row.tags.every((tag) => typeof tag === "string")) return null;
  return { note: row.note.slice(0, 500), tags: row.tags.slice(0, 12) as string[], cleared: row.cleared };
}

function sameState(left: AnnotationState, right: AnnotationState): boolean {
  return left.note === right.note && left.cleared === right.cleared && JSON.stringify(left.tags) === JSON.stringify(right.tags);
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
    if (!expected || !restore) return badRequest("Invalid annotation state");
    const { data: transaction, error: transactionError } = await supabase.from("transactions").select("id").eq("id", body.transaction_id).eq("user_id", user.id).maybeSingle();
    if (transactionError) throw transactionError;
    if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    const { data: current, error: currentError } = await supabase.from("transaction_annotations").select("note,tags,cleared_at,display_category,cash_flow_classification,goal_id,rule_actions").eq("user_id", user.id).eq("transaction_id", body.transaction_id).maybeSingle();
    if (currentError) throw currentError;
    const currentState: AnnotationState = { note: current?.note ?? "", tags: current?.tags ?? [], cleared: Boolean(current?.cleared_at) };
    if (!sameState(currentState, expected)) return NextResponse.json({ error: "This transaction changed; undo was not applied." }, { status: 409 });
    const payload = {
      user_id: user.id,
      transaction_id: body.transaction_id,
      note: restore.note,
      tags: restore.tags,
      cleared_at: restore.cleared ? (current?.cleared_at ?? new Date().toISOString()) : null,
      display_category: current?.display_category ?? null,
      cash_flow_classification: current?.cash_flow_classification ?? null,
      goal_id: current?.goal_id ?? null,
      rule_actions: current?.rule_actions ?? null,
    };
    const { error } = await supabase.from("transaction_annotations").upsert(payload, { onConflict: "user_id,transaction_id" });
    if (error) throw error;
    invalidateDashboardCache(user.id);
    await writeAudit({ userId: user.id, action: "transaction_annotation_undone", metadata: { transaction_id: body.transaction_id }, ip: getClientIp(request) });
    return NextResponse.json({ undone: true });
  } catch (error) {
    return errorResponse("transactions.undo-annotation", error);
  }
}
