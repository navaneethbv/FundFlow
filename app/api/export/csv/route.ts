import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { toCsv } from "@/lib/csv";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Download a privacy-safe CSV report: merchant, amount, date, category only.
 * No account numbers, tokens, or identifiers. Intended for the user to feed to
 * an external AI. Gated by the profile's ai_export_enabled setting.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    // Respect the user's export opt-out.
    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_export_enabled")
      .eq("id", user.id)
      .single();
    if (profile && profile.ai_export_enabled === false) {
      return NextResponse.json(
        { error: "Data export is disabled in your settings." },
        { status: 403 },
      );
    }

    // RLS ensures only this user's transactions are returned.
    const { data: txns, error } = await supabase
      .from("transactions")
      .select("date, merchant_name, name, amount, pfc_primary, pfc_detailed")
      .order("date", { ascending: false });
    if (error) throw error;

    const rows = (txns ?? []).map((t) => [
      t.date,
      t.merchant_name ?? t.name ?? "",
      t.amount,
      t.pfc_detailed ?? t.pfc_primary ?? "",
    ]);

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
