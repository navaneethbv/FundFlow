import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchFinanceTransactions } from "@/lib/finance-query";
import { projectFinanceTransactions } from "@/lib/finance-domain";
import { parseFinancialScope } from "@/lib/financial-scope";
import { toCsv } from "@/lib/csv";
import { writeAudit } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const startDate = url.searchParams.get("start") || "2026-01-01";
    const endDate = url.searchParams.get("end") || "2026-12-31";

    const scope = parseFinancialScope({
      raw: url.searchParams.get("scope") || undefined,
      ownerUserId: user.id,
      visibleHouseholdIds: [],
    });

    const { rows } = await fetchFinanceTransactions(supabase, {
      scope,
      window: { start: startDate, endExclusive: endDate },
    });

    const canonicalTxns = projectFinanceTransactions({
      rows,
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [],
    });

    const headers = ["date", "merchant", "category", "flow", "amount", "source"];
    const rowValues = canonicalTxns.map((t) => [
      t.date,
      t.merchant,
      t.categoryKey,
      t.flow,
      t.signedAmount,
      t.source,
    ]);

    const csvContent = toCsv(headers, rowValues);

    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { startDate, endDate },
    });

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="report-${startDate}-${endDate}.csv"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to export CSV";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
