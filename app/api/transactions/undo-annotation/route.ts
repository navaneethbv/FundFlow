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

type UndoBody = { transactionId: string; expected: AnnotationState; restore: AnnotationState };

function parseBody(body: { transaction_id?: unknown; expected?: unknown; restore?: unknown } | null): UndoBody | NextResponse {
  if (typeof body?.transaction_id !== "string" || !UUID.test(body.transaction_id)) return badRequest("Invalid transaction_id");
  const expected = parseState(body.expected);
  const restore = parseState(body.restore);
  if (!expected || !restore) return badRequest("Invalid annotation state");
  return { transactionId: body.transaction_id, expected, restore };
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("undoToasts")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const parsed = parseBody(await request.json().catch(() => null));
    if (parsed instanceof NextResponse) return parsed;
    const { transactionId, expected, restore } = parsed;
    const { data: transaction, error: transactionError } = await supabase.from("transactions").select("id").eq("id", transactionId).eq("user_id", user.id).maybeSingle();
    if (transactionError) throw transactionError;
    if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    const { data: current, error: currentError } = await supabase.from("transaction_annotations").select("note,tags,cleared_at").eq("user_id", user.id).eq("transaction_id", transactionId).maybeSingle();
    if (currentError) throw currentError;
    const currentState: AnnotationState = { note: current?.note ?? "", tags: current?.tags ?? [], cleared: Boolean(current?.cleared_at) };
    if (!sameState(currentState, expected)) return NextResponse.json({ error: "This transaction changed; undo was not applied." }, { status: 409 });
    // Only the restored columns are written: an upsert leaves the others as
    // they are, and rule_actions is server-only since compound rules.
    const clearedAt = restore.cleared ? (current?.cleared_at ?? new Date().toISOString()) : null;
    const { error } = await supabase.from("transaction_annotations").upsert(
      { user_id: user.id, transaction_id: transactionId, note: restore.note, tags: restore.tags, cleared_at: clearedAt },
      { onConflict: "user_id,transaction_id" },
    );
    if (error) throw error;
    invalidateDashboardCache(user.id);
    await writeAudit({ userId: user.id, action: "transaction_annotation_undone", metadata: { transaction_id: transactionId }, ip: getClientIp(request) });
    return NextResponse.json({ undone: true });
  } catch (error) {
    return errorResponse("transactions.undo-annotation", error);
  }
}
