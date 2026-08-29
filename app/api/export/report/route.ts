import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import {
  DEFAULT_REPORT_TIMEZONE,
  getMonthlyReportPeriod,
  getWeeklyReportPeriod,
  normalizeReportTimezone,
  type WeeklyReportPeriod,
} from "@/lib/report-period";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit, getClientIp } from "@/lib/audit";
import { isExportAllowed } from "@/lib/export";

/**
 * On-demand download of the spending-insights PDF for the signed-in user. The
 * same loader the Monday cron uses builds the document (paginated and
 * split-chunked so a busy period cannot exceed the Supabase response cap), and
 * `period.kind` decides whether budgets prorate weekly and whether the copy
 * reads "week" or "month".
 *
 *   - `?month=YYYY-MM` (the Review page): that calendar month is the period,
 *     the previous month is the comparison baseline. An invalid month is 400.
 *   - no parameter (the Reports and Settings download links): the most recently
 *     completed Mon-Sun week in the user's timezone, matching the cron.
 *
 * Needs the service client (getWeeklyReportData resolves the email via the
 * auth admin API) but is strictly scoped to the requesting user's id.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const month = new URL(request.url).searchParams.get("month");
  let period: WeeklyReportPeriod | null = null;
  if (month !== null) {
    period = getMonthlyReportPeriod(month);
    if (!period) {
      return badRequest('Provide a valid "month" parameter as YYYY-MM.');
    }
  }

  try {
    const service = createServiceClient();
    if (!(await isExportAllowed(service, user.id))) {
      return NextResponse.json(
        { error: "Data export is disabled in your settings." },
        { status: 403 },
      );
    }

    if (!period) {
      const { data: profile } = await service
        .from("profiles")
        .select("timezone")
        .eq("id", user.id)
        .maybeSingle();
      const timezone = normalizeReportTimezone(
        profile?.timezone ?? DEFAULT_REPORT_TIMEZONE,
      );
      period = getWeeklyReportPeriod(new Date(), timezone);
    }

    const reportData = await getWeeklyReportData(service, user.id, period);
    if (!reportData) {
      return NextResponse.json(
        { error: "No report data available yet. Connect a bank and sync first." },
        { status: 404 },
      );
    }

    const pdf = await generateWeeklyReportPdf(reportData);
    const periodSlug = month ?? period.start;

    await writeAudit({
      userId: user.id,
      action: "data_export",
      metadata: { format: "pdf_report", period: periodSlug },
      ip: getClientIp(request),
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="fundflow-report-${periodSlug}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export.report", error);
  }
}
