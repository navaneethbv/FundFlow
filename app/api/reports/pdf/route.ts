import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { parseFinancialScope } from "@/lib/financial-scope";
import { summarizeTransactions } from "@/lib/reports";
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

    const { transactions } = await loadCanonicalProjection(supabase, {
      scope,
      window: { start: startDate, endExclusive: endDate },
    });

    const summary = summarizeTransactions(transactions);

    // Build minimal PDF text report
    const pdfText = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kinds [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >> endobj
4 0 obj << /Length 120 >> stream
BT /F1 12 Tf 50 700 TD (FundFlow Year in Money Report) Tj 50 680 TD (Total Income: $${summary.totalIncome}) Tj 50 660 TD (Total Spending: $${summary.totalSpending}) Tj ET
endstream endobj
xref
0 5
trailer << /Root 1 0 R >>
%%EOF`;

    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { startDate, endDate, format: "pdf" },
    });

    return new NextResponse(pdfText, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report-${startDate}-${endDate}.pdf"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate PDF report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
