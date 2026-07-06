import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { fetchPrivacySafeRows } from "@/lib/export";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Privacy-safe JSON export — the same date/merchant/amount/category contract
 * as the CSV, for tools that ingest JSON directly. Gated by ai_export_enabled
 * and audited like every export.
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

    const service = createServiceClient();
    await service.from("data_exports").insert({
      user_id: user.id,
      format: "json",
      row_count: result.rows.length,
    });
    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { format: "json", row_count: result.rows.length },
      ip: getClientIp(request),
    });

    return new NextResponse(JSON.stringify(result.rows, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="fundflow-transactions.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export.json", error);
  }
}
