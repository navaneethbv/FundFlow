import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, requireCronAuth } from "@/lib/http";
import { alertCronFailure } from "@/lib/cron-alert";
import { redactEmails } from "@/lib/delivery-error";
import { runWeeklyReports } from "@/lib/weekly-report-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runWeeklyReports();
    if (result.reports_failed > 0) {
      await alertCronFailure("weekly-report", {
        failed: result.reports_failed,
        total: result.due,
        firstError: result.first_error,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await alertCronFailure("weekly-report", {
      failed: 1,
      total: 1,
      firstError: redactEmails(
        error instanceof Error ? error.message : String(error),
      ),
    });
    return errorResponse("cron.weekly-report", error);
  }
}
