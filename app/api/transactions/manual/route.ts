import { NextRequest, NextResponse } from "next/server";
import { POST as annotatePost } from "@/app/api/transactions/annotate/route";
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
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const service = createServiceClient();
    const { data: txn, error } = await service
      .from("transactions")
      .insert({
        user_id: user.id,
        account_id: input.account.source === "plaid" ? input.account.id : null,
        manual_account_id: input.account.source === "manual" ? input.account.id : null,
        plaid_transaction_id: `manual-${crypto.randomUUID()}`,
        amount: input.signedAmount,
        date: input.date,
        name: input.merchant,
        merchant_name: input.merchant,
        pfc_primary: input.category,
        source: "manual",
        pending: false,
      })
      .select("id")
      .single();
    if (error) throw error;

    if (input.goalId || input.notes) {
      const linkRequest = new NextRequest("https://internal/api/transactions/annotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transaction_id: txn.id,
          note: input.notes,
          goal_id: input.goalId,
        }),
      });
      await annotatePost(linkRequest);
    }

    await writeAudit({
      userId: user.id,
      action: "manual_transaction_created",
      metadata: { transaction_id: txn.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ id: txn.id }, { status: 201 });
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
    if (!txn || txn.source !== "manual") {
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
