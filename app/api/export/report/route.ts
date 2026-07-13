import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/http";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import {
  DEFAULT_REPORT_TIMEZONE,
  getWeeklyReportPeriod,
  normalizeReportTimezone,
} from "@/lib/report-period";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * On-demand download of the weekly PDF report, the same document the Monday
 * cron emails, generated now for the signed-in user. Needs the service client
 * (getWeeklyReportData resolves the email via the auth admin API) but is
 * strictly scoped to the requesting user's id.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const service = createServiceClient();
    const { data: profile } = await service
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timezone = normalizeReportTimezone(
      profile?.timezone ?? DEFAULT_REPORT_TIMEZONE,
    );
    const period = getWeeklyReportPeriod(new Date(), timezone);
    const reportData = await getWeeklyReportData(service, user.id, period);
    if (!reportData) {
      return NextResponse.json(
        { error: "No report data available yet. Connect a bank and sync first." },
        { status: 404 },
      );
    }

    const pdf = await generateWeeklyReportPdf(reportData);
    const dateStr = new Date().toISOString().slice(0, 10);

    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { format: "pdf_report" },
      ip: getClientIp(request),
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="fundflow-report-${dateStr}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export.report", error);
  }
}
