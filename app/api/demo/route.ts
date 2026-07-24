import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { buildDemoDataset } from "@/lib/demo-data";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";

/**
 * Demo mode (7.4): load/clear a deterministic sample dataset so the app can
 * be shown or screenshotted with zero real numbers. Loading is refused
 * while any real bank is connected — demo data never mixes with real data.
 * The fake item is status 'disconnected', so every sync path ignores it.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const { data: existingItems } = await supabase
      .from("plaid_items")
      .select("plaid_item_id");
    const hasRealBank = (existingItems ?? []).some(
      (item) => !(item.plaid_item_id as string).startsWith("demo-"),
    );
    if (hasRealBank) {
      return NextResponse.json(
        { error: "Demo data can't be loaded while a real bank is connected." },
        { status: 409 },
      );
    }

    const dataset = buildDemoDataset({
      userId: user.id,
      today: new Date().toISOString().slice(0, 10),
    });

    const service = createServiceClient();
    // Idempotent: clear any prior demo rows first (cascade), then insert.
    await service
      .from("plaid_items")
      .delete()
      .eq("user_id", user.id)
      .like("plaid_item_id", "demo-%");

    const { data: itemRow, error: itemError } = await service
      .from("plaid_items")
      .insert({
        user_id: user.id,
        plaid_item_id: dataset.item.plaid_item_id,
        institution_name: dataset.item.institution_name,
        status: dataset.item.status,
        access_token_ciphertext: "demo",
        access_token_iv: "demo",
        access_token_tag: "demo",
      })
      .select("id")
      .single();
    if (itemError) throw itemError;

    const { data: accountRows, error: accountError } = await service
      .from("accounts")
      .insert(
        dataset.accounts.map((account) => ({
          user_id: user.id,
          plaid_item_id: itemRow.id,
          ...account,
        })),
      )
      .select("id");
    if (accountError) throw accountError;
    const accountIds = (accountRows ?? []).map((row) => row.id as string);

    const txnRows = dataset.transactions.map((txn) => ({
      user_id: user.id,
      account_id: accountIds[txn.accountIndex],
      plaid_transaction_id: txn.plaid_transaction_id,
      date: txn.date,
      amount: txn.amount,
      name: txn.name,
      merchant_name: txn.merchant_name,
      pfc_primary: txn.pfc_primary,
      pending: txn.pending,
    }));
    for (let i = 0; i < txnRows.length; i += 500) {
      const { error } = await service
        .from("transactions")
        .insert(txnRows.slice(i, i + 500));
      if (error) throw error;
    }

    invalidateDashboardCache(user.id);
    await writeAudit({
      userId: user.id,
      action: "demo_data_loaded",
      metadata: { transactions: txnRows.length },
    });
    return NextResponse.json({ ok: true, transactions: txnRows.length });
  } catch (error) {
    return errorResponse("demo.load", error);
  }
}

export async function DELETE() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const service = createServiceClient();
    const { error } = await service
      .from("plaid_items")
      .delete()
      .eq("user_id", user.id)
      .like("plaid_item_id", "demo-%");
    if (error) throw error;

    invalidateDashboardCache(user.id);
    await writeAudit({ userId: user.id, action: "demo_data_cleared" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("demo.clear", error);
  }
}
