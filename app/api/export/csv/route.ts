import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
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
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const result = await fetchPrivacySafeRows(supabase, user.id);
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Data export is disabled in your settings." },
        { status: 403 },
      );
    }

    const rows = result.rows.map((r) => [r.date, r.merchant, r.amount, r.category]);
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
        "Content-Disposition": 'attachment; filename="fundflow-transactions.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export.csv", error);
  }
}
