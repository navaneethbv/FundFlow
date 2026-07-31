import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { errorResponse, requireUser } from "@/lib/http";
import { buildInvestmentsPage } from "@/lib/investments";
import { loadHoldingSnapshots, loadHoldings } from "@/lib/investments-data";

export async function GET(request: NextRequest) {
  if (!isFeatureEnabled("investmentsPage")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const [holdings, snapshots] = await Promise.all([
      loadHoldings(supabase),
      loadHoldingSnapshots(supabase),
    ]);
    const page = buildInvestmentsPage(holdings, snapshots);
    const rows = page.byClass.flatMap((group) =>
      group.holdings.map((h) => [
        group.label,
        h.securityName,
        h.ticker,
        h.accountName,
        h.quantity,
        h.price,
        h.value,
        h.weightPct,
      ]),
    );

    const csv = toCsv(
      ["asset_class", "security", "ticker", "account", "quantity", "price", "value", "weight_pct"],
      rows,
    );

    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { kind: "investments_csv", rows: rows.length },
      ip: getClientIp(request),
    });

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="fundflow-investments.csv"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export.investments-csv", error);
  }
}
