import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { makeImportId } from "@/lib/import";
import { createServiceClient } from "@/lib/supabase/service";

const UPSERT_CHUNK = 500;

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = await request.json().catch(() => null);
    const batchId = body?.batch_id;
    const accountId = body?.account_id;
    const approvedIds = Array.isArray(body?.approved_row_ids) ? body.approved_row_ids : null;
    if (typeof batchId !== "string" || typeof accountId !== "string") {
      return badRequest("batch_id and account_id are required");
    }

    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    let query = supabase
      .from("import_review_rows")
      .select("id, date, description, amount, status")
      .eq("batch_id", batchId)
      .eq("status", "pending");
    if (approvedIds) query = query.in("id", approvedIds);
    const { data: rows, error: rowError } = await query;
    if (rowError) throw rowError;

    const occurrences = new Map<string, number>();
    const dbRows = (rows ?? []).map((row) => {
      const imported = {
        date: row.date as string,
        amount: Number(row.amount),
        merchant: row.description as string,
        category: null,
      };
      const key = `${imported.date}|${imported.amount}|${imported.merchant}`;
      const n = occurrences.get(key) ?? 0;
      occurrences.set(key, n + 1);
      return {
        user_id: user.id,
        account_id: accountId,
        plaid_transaction_id: makeImportId(accountId, imported, n),
        amount: imported.amount,
        date: imported.date,
        name: imported.merchant,
        merchant_name: imported.merchant,
        pending: false,
      };
    });

    const service = createServiceClient();
    for (let i = 0; i < dbRows.length; i += UPSERT_CHUNK) {
      const { error } = await service
        .from("transactions")
        .upsert(dbRows.slice(i, i + UPSERT_CHUNK), { onConflict: "plaid_transaction_id" });
      if (error) throw error;
    }

    const rowIds = (rows ?? []).map((row) => row.id);
    if (rowIds.length > 0) {
      const { error: updateRowsError } = await service
        .from("import_review_rows")
        .update({ status: "committed" })
        .eq("user_id", user.id)
        .in("id", rowIds);
      if (updateRowsError) throw updateRowsError;
    }
    const { error: batchError } = await service
      .from("import_review_batches")
      .update({ status: "committed" })
      .eq("user_id", user.id)
      .eq("id", batchId);
    if (batchError) throw batchError;

    return NextResponse.json({ ok: true, imported: dbRows.length });
  } catch (error) {
    return errorResponse("import.commit", error);
  }
}
