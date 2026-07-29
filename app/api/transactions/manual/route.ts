import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeManualTxn } from "@/lib/manual-transaction";
import { writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const normalized = normalizeManualTxn(body);

    const { data, error } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        account_id: normalized.accountId,
        manual_account_id: normalized.manualAccountId,
        date: normalized.date,
        amount: normalized.amount,
        merchant_name: normalized.merchant,
        name: normalized.merchant,
        pfc_primary: normalized.category || "GENERAL_MERCHANDISE",
        source: "manual",
        pending: false,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAudit({
      userId: user.id,
      action: "data_refresh",
      metadata: { transaction_id: data.id },
    });

    return NextResponse.json({ transaction: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create manual transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
