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

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    if (!id) return badRequest("id is required");
    const receipt = await loadOwnedReceipt(auth.supabase, auth.user.id, id);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null) as {
      action?: unknown;
      transactionId?: unknown;
    } | null;
    if (!body || !["attach", "ignore", "restore"].includes(String(body.action))) {
      return badRequest("action is not supported");
    }

    let update: { transaction_id: string | null; status: "matched" | "ignored" | "unmatched" };
    let auditAction: AuditAction;
    if (body.action === "attach") {
      if (typeof body.transactionId !== "string" || !body.transactionId) {
        return badRequest("transactionId is required");
      }
      const { data: transaction, error: transactionError } = await auth.supabase
        .from("transactions")
        .select("id")
        .eq("id", body.transactionId)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (transactionError) throw transactionError;
      if (!transaction) {
        return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
      }
      update = { transaction_id: body.transactionId, status: "matched" };
      auditAction = "receipt_attached";
    } else if (body.action === "ignore") {
      update = { transaction_id: null, status: "ignored" };
      auditAction = "receipt_ignored";
    } else {
      update = { transaction_id: null, status: "unmatched" };
      auditAction = "receipt_restored";
    }

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
      ip: getClientIp(request),
    });
    return NextResponse.json({ receipt: updated });
  } catch (error) {
    return errorResponse("receipts.update", error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
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
      ip: getClientIp(request),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("receipts.delete", error);
  }
}
