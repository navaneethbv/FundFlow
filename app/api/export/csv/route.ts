import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { fetchPrivacySafeRows } from "@/lib/export";
import { exportError, recordExport, resolveExportContext } from "@/lib/export-route";

/**
 * Download a privacy-safe CSV report: merchant, amount, date, category only.
 * No account numbers, tokens, or identifiers. Intended for the user to feed to
 * an external AI. Gated by the profile's ai_export_enabled setting (the data
 * contract lives in lib/export.ts, shared with the JSON export).
 */
export async function GET(request: NextRequest) {
  const context = await resolveExportContext(request);
  if (context instanceof NextResponse) return context;
  const { userId, supabase } = context;

  try {
    const result = await fetchPrivacySafeRows(supabase, userId);
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
        .eq("user_id", userId)
        .contains("tags", ["tax"]);
      const ids = (tagged ?? []).map((r) => r.transaction_id as string);
      const { data: taxTxns } = ids.length
        ? await supabase
            .from("transactions")
            .select("date, amount, merchant_name, name, pfc_primary")
            .eq("user_id", userId)
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

    await recordExport({ request, userId, format: "csv", rowCount: rows.length });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fundflow-${request.nextUrl.searchParams.get("scope") === "tax" ? "tax" : "transactions"}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return exportError("export.csv", error);
  }
}
