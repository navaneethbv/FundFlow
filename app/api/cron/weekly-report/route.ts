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

    const allUserIds = [...new Set((items ?? []).map((r) => r.user_id as string))];

    // Respect the per-user opt-out (Settings → Weekly email report).
    const { data: optedIn, error: prefError } = await service
      .from("profiles")
      .select("id")
      .in("id", allUserIds)
      .eq("weekly_report_enabled", true);
    if (prefError) throw prefError;
    const userIds = (optedIn ?? []).map((r) => r.id as string);

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
        if (err instanceof Error && err.message.includes("SMTP is not configured")) {
          await service.from("notifications").insert({
            user_id: userId,
            type: "broken_bank",
            severity: "danger",
            title: "Weekly report skipped",
            body: "We could not send your weekly report because SMTP is not configured in production settings.",
          });
        }
      }
    }

    return NextResponse.json({ ok: true, users: userIds.length, reports_sent: sentCount });
  } catch (error) {
    return errorResponse("cron.weekly-report", error);
  }
}
