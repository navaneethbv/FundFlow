import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIp, writeAudit, type AuditAction } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface OwnedReceipt {
  id: string;
  storage_path: string;
}

async function loadOwnedReceipt(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<OwnedReceipt | null> {
  const { data, error } = await supabase
    .from("receipts")
    .select("id,storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as OwnedReceipt | null;
}

interface PatchResult {
  update: { transaction_id: string | null; status: "matched" | "ignored" | "unmatched" };
  auditAction: AuditAction;
  response?: NextResponse;
}

async function prepareReceiptPatch(
  supabase: SupabaseClient,
  userId: string,
  action: string,
  transactionId?: unknown,
): Promise<PatchResult> {
  if (action === "attach") {
    if (typeof transactionId !== "string" || !transactionId) {
      return { update: { transaction_id: null, status: "matched" }, auditAction: "receipt_attached", response: badRequest("transactionId is required") };
    }
    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .select("id")
      .eq("id", transactionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (transactionError) throw transactionError;
    if (!transaction) {
      return { update: { transaction_id: null, status: "matched" }, auditAction: "receipt_attached", response: NextResponse.json({ error: "Transaction not found" }, { status: 404 }) };
    }
    return {
      update: { transaction_id: transactionId, status: "matched" },
      auditAction: "receipt_attached",
    };
  }
  if (action === "ignore") {
    return { update: { transaction_id: null, status: "ignored" }, auditAction: "receipt_ignored" };
  }
  return { update: { transaction_id: null, status: "unmatched" }, auditAction: "receipt_restored" };
}

async function executeReceiptPatch(
  auth: { user: { id: string }; supabase: SupabaseClient },
  id: string,
  body: { action?: unknown; transactionId?: unknown } | null,
  ip: string | null,
): Promise<NextResponse> {
  if (!id) return badRequest("id is required");
  const receipt = await loadOwnedReceipt(auth.supabase, auth.user.id, id);
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  if (!body || !["attach", "ignore", "restore"].includes(String(body.action))) {
    return badRequest("action is not supported");
  }

  const patchPrep = await prepareReceiptPatch(
    auth.supabase,
    auth.user.id,
    String(body.action),
    body.transactionId,
  );
  if (patchPrep.response) return patchPrep.response;
  const { update, auditAction } = patchPrep;

  const service = createServiceClient();
  const { data: updated, error } = await service
    .from("receipts")
    .update(update)
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("id,transaction_id,merchant,purchase_date,total,status,created_at")
    .single();
  if (error) throw error;
  if (!updated) throw new Error("Receipt update returned no row");
  await writeAudit({
    userId: auth.user.id,
    action: auditAction,
    metadata: {
      receipt_id: id,
      ...(body.action === "attach" ? { transaction_id: body.transactionId } : {}),
    },
    ip,
  });
  return NextResponse.json({ receipt: updated });
}

async function executeReceiptDelete(
  auth: { user: { id: string }; supabase: SupabaseClient },
  id: string,
  ip: string | null,
): Promise<NextResponse> {
  if (!id) return badRequest("id is required");
  const receipt = await loadOwnedReceipt(auth.supabase, auth.user.id, id);
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { error: storageError } = await service.storage
    .from("receipts")
    .remove([receipt.storage_path]);
  if (storageError) throw storageError;
  const { error } = await service
    .from("receipts")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) throw error;
  await writeAudit({
    userId: auth.user.id,
    action: "receipt_deleted",
    metadata: { receipt_id: id },
    ip,
  });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      transactionId?: unknown;
    } | null;
    return await executeReceiptPatch(auth, id, body, getClientIp(request));
  } catch (error) {
    return errorResponse("receipts.update", error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    return await executeReceiptDelete(auth, id, getClientIp(request));
  } catch (error) {
    return errorResponse("receipts.delete", error);
  }
}
