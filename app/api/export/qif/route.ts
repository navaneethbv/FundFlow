import { NextResponse, type NextRequest } from "next/server";
import { fetchPrivacySafeRows } from "@/lib/export";
import { toQif } from "@/lib/export-formats";
import { exportError, recordExport, resolveExportContext } from "@/lib/export-route";

export const dynamic = "force-dynamic";

/**
 * Download a privacy-safe QIF file for importing into Quicken, GnuCash, or YNAB.
 * Respects the user's ai_export_enabled setting and server-side privacy boundaries.
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

    const qif = toQif(result.rows);
    await recordExport({ request, userId, format: "qif", rowCount: result.rows.length });

    return new NextResponse(qif, {
      status: 200,
      headers: {
        "Content-Type": "application/x-qif; charset=utf-8",
        "Content-Disposition": 'attachment; filename="fundflow-transactions.qif"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return exportError("export.qif", error);
  }
}
