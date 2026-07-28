import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { verifyApiToken } from "@/lib/api-tokens";
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
  let userId: string;
  let supabase;
  if (auth instanceof NextResponse) {
    // API-token path (6.1) — service client + explicit scoping inside
    // fetchPrivacySafeRows.
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
