import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { safeEqual } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { getWeeklyReportData, generateWeeklyReportPdf, sendWeeklyReportEmail } from "@/lib/reporting";
import { errorResponse } from "@/lib/http";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly cron endpoint that fetches active users, calculates weekly insights,
 * generates a PDF summary, and emails it to the user.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  if (!safeEqual(header, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const service = createServiceClient();
    const { data: items, error } = await service
      .from("plaid_items")
      .select("user_id")
      .eq("status", "active");
    if (error) throw error;

    const userIds = [...new Set((items ?? []).map((r) => r.user_id as string))];
    const dateStr = new Date().toISOString().slice(0, 10);

    let sentCount = 0;
    for (const userId of userIds) {
      try {
        const reportData = await getWeeklyReportData(service, userId);
        if (!reportData) continue;

        const pdfBuffer = await generateWeeklyReportPdf(reportData);
        await sendWeeklyReportEmail(reportData.userEmail, pdfBuffer, dateStr);
        sentCount += 1;
      } catch (err) {
        logError("cron.weekly-report.user", err);
      }
    }

    return NextResponse.json({ ok: true, users: userIds.length, reports_sent: sentCount });
  } catch (error) {
    return errorResponse("cron.weekly-report", error);
  }
}
