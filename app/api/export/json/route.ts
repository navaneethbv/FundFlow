import { NextResponse, type NextRequest } from "next/server";
import { fetchPrivacySafeRows } from "@/lib/export";
import { exportError, recordExport, resolveExportContext } from "@/lib/export-route";

/**
 * Privacy-safe JSON export — the same date/merchant/amount/category contract
 * as the CSV, for tools that ingest JSON directly. Gated by ai_export_enabled
 * and audited like every export.
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

    await recordExport({ request, userId, format: "json", rowCount: result.rows.length });

    return new NextResponse(JSON.stringify(result.rows, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="fundflow-transactions.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return exportError("export.json", error);
  }
}
