import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { toCsv } from "@/lib/csv";
import { partitionCashFlowByCurrency } from "@/lib/cash-flow";
import { isExportAllowed } from "@/lib/export";
import { loadReportData, resolveReportScope } from "@/lib/reports-data";
import {
  defaultReportFilters,
  reportFiltersFromSearchParams,
} from "@/lib/reports";
import { serializeFinancialScope } from "@/lib/financial-scope";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * The Reports page's "Download CSV": the exact filtered row set behind the
 * chart, through the privacy-safe export contract (date / merchant / amount /
 * category only, no account ids, masks, or provider identifiers; merchant is
 * the user's own transaction text, exported verbatim).
 *
 * Session-only by design. The `/api/export/csv` API-token path exists for
 * unattended scripts pulling everything; this endpoint's meaning depends on URL
 * filters a script has no way to intend, and adding the token path would widen
 * the token's reach for no benefit.
 *
 * `toCsv` neutralizes spreadsheet formulas (merchant names are bank-supplied,
 * so attacker-influenced), and the read is bounded by `loadReportData`.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!(await isExportAllowed(supabase, user.id))) {
      return NextResponse.json(
        { error: "Data export is disabled in your settings." },
        { status: 403 },
      );
    }

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const { scope } = await resolveReportScope(
      supabase,
      user.id,
      request.nextUrl.searchParams.get("scope") ?? undefined,
    );
    const anchorMonth = new Date().toISOString().slice(0, 7);
    const filters = {
      ...reportFiltersFromSearchParams(
        {
          ...params,
          // Repeated params collapse in Object.fromEntries, so read the lists
          // from the source to keep every account/merchant/category choice.
          account: request.nextUrl.searchParams.getAll("account"),
          merchant: request.nextUrl.searchParams.getAll("merchant"),
          category: request.nextUrl.searchParams.getAll("category"),
        },
        defaultReportFilters(anchorMonth),
      ),
      scope: serializeFinancialScope(scope) ?? null,
    };

    const { transactions, currencyByAccountId, truncated } =
      await loadReportData(supabase, {
        scope,
        filters,
      });

    // The page partitions the visible report by currency and emits a single
    // unlabeled amount column, so the CSV must carry the same partition.
    // Without it, differently denominated rows would be combined in one file.
    const requestedCurrency = request.nextUrl.searchParams.get("currency");
    const byCurrency = partitionCashFlowByCurrency(
      transactions,
      currencyByAccountId,
    );
    const exportRows = requestedCurrency
      ? (byCurrency.get(requestedCurrency) ?? [])
      : transactions;

    const rows = exportRows.map((row) => [
      row.date,
      row.merchant || "Unknown",
      row.signedAmount,
      row.categoryKey || "UNCATEGORIZED",
    ]);
    const csv = toCsv(["date", "merchant", "amount", "category"], rows);

    const service = createServiceClient();
    await service.from("data_exports").insert({
      user_id: user.id,
      format: "csv",
      row_count: rows.length,
    });
    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: {
        format: "csv",
        source: "report",
        row_count: rows.length,
        truncated,
      },
      ip: getClientIp(request),
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fundflow-report-${filters.start}-to-${filters.end}.csv"`,
        "Cache-Control": "no-store",
        // The page shows a visible banner too; this is for scripted callers.
        "X-FundFlow-Truncated": truncated ? "true" : "false",
      },
    });
  } catch (error) {
    return errorResponse("export.report-csv", error);
  }
}
