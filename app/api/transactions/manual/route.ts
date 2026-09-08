import { NextRequest, NextResponse } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { normalizeManualTxn } from "@/lib/manual-transaction";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Manual ledger entries never get general client insert access to
 * `transactions` — RLS has no client write policy on that table at all — so
 * every manual row goes through this route: confirm the chosen account
 * belongs to the caller, then write with the service client and an explicit
 * `user_id`.
 */
export async function POST(request: NextRequest) {
  // Gated the same as the ledger UI: manual_account_id/source don't exist
  // until 20260730240000_manual_transactions_receipts.sql is applied, and a
  // hidden button is not the only way to reach a route.
  if (!isFeatureEnabled("transactionsParity")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const today = new Date().toISOString().slice(0, 10);
    const result = normalizeManualTxn(body, today);
    if (!result.ok) return badRequest(result.error);
    const input = result.value;

    const table = input.account.source === "plaid" ? "accounts" : "manual_accounts";
    const { data: account, error: accountError } = await supabase
      .from(table)
      .select("id")
      .eq("id", input.account.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const { data: transactionId, error } = await createServiceClient().rpc("create_manual_transaction_atomic", {
      p_user_id: user.id, p_source: input.account.source, p_account_id: input.account.id,
      p_amount: input.signedAmount, p_date: input.date, p_merchant: input.merchant,
      p_category: input.category, p_note: input.notes, p_goal_id: input.goalId,
    });
    if (error?.code === "22023") return badRequest(error.message);
    if (error) throw error;
    if (!transactionId) throw new Error("Manual transaction creation returned no id");

    await writeAudit({
      userId: user.id,
      action: "manual_transaction_created",
      metadata: { transaction_id: transactionId },
      ip: getClientIp(request),
    });

    return NextResponse.json({ id: transactionId }, { status: 201 });
  } catch (error) {
    return errorResponse("transactions.manual.create", error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!isFeatureEnabled("transactionsParity")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== "string" || !body.id) return badRequest("id is required");

    const { data: txn, error: findError } = await supabase
      .from("transactions")
      .select("id, source")
      .eq("id", body.id)
      .maybeSingle();
    if (findError) throw findError;
    if (txn?.source !== "manual") {
      return NextResponse.json({ error: "Manual transaction not found" }, { status: 404 });
    }

    const service = createServiceClient();
    const { error } = await service
      .from("transactions")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id)
      .eq("source", "manual");
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "manual_transaction_deleted",
      metadata: { transaction_id: body.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("transactions.manual.delete", error);
  }
}
