import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { verifyApiToken } from "@/lib/api-tokens";
import { toCsv } from "@/lib/csv";
import { fetchPrivacySafeRows } from "@/lib/export";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Download a privacy-safe CSV report: merchant, amount, date, category only.
 * No account numbers, tokens, or identifiers. Intended for the user to feed to
 * an external AI. Gated by the profile's ai_export_enabled setting (the data
 * contract lives in lib/export.ts, shared with the JSON export).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  let userId: string;
  let supabase;
  if (auth instanceof NextResponse) {
    // Personal read-only API tokens (6.1): scripts may call the export
    // endpoints with "Authorization: Bearer fft_...". The service client is
    // used because there is no session — fetchPrivacySafeRows scopes every
    // query by userId explicitly.
    const tokenUserId = await verifyApiToken(request.headers.get("authorization"));
    if (!tokenUserId) return auth;
    userId = tokenUserId;
    supabase = createServiceClient();
  } else {
    userId = auth.user.id;
    supabase = auth.supabase;
  }
  const user = { id: userId };

  try {
    const result = await fetchPrivacySafeRows(supabase, user.id);
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Data export is disabled in your settings." },
        { status: 403 },
      );
    }

    // Tax season preset (6.4): only transactions the user tagged "tax" in
    // the ledger editor. Same privacy contract. Both queries filter user_id
    // explicitly — on the API-token path `supabase` is the service client,
    // which bypasses RLS, so leaning on RLS here would leak across users.
    const scope = request.nextUrl.searchParams.get("scope");
    let exportRows = result.rows;
    if (scope === "tax") {
      const { data: tagged } = await supabase
        .from("transaction_annotations")
        .select("transaction_id")
        .eq("user_id", user.id)
        .contains("tags", ["tax"]);
      const ids = (tagged ?? []).map((r) => r.transaction_id as string);
      const { data: taxTxns } = ids.length
        ? await supabase
            .from("transactions")
            .select("date, amount, merchant_name, name, pfc_primary")
            .eq("user_id", user.id)
            .in("id", ids)
            .order("date")
        : { data: [] as never[] };
      exportRows = (taxTxns ?? []).map((t) => ({
        date: t.date as string,
        merchant: (t.merchant_name ?? t.name ?? "Unknown") as string,
        amount: Number(t.amount),
        category: (t.pfc_primary ?? "UNCATEGORIZED") as string,
      }));
    }

    const rows = exportRows.map((r) => [r.date, r.merchant, r.amount, r.category]);
    const csv = toCsv(["date", "merchant", "amount", "category"], rows);

    // Audit + record the export using the service client.
    const service = createServiceClient();
    await service.from("data_exports").insert({
      user_id: user.id,
      format: "csv",
      row_count: rows.length,
    });
    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { format: "csv", row_count: rows.length },
      ip: getClientIp(request),
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fundflow-${request.nextUrl.searchParams.get("scope") === "tax" ? "tax" : "transactions"}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export.csv", error);
  }
}
