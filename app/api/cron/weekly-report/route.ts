import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { safeEqual } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import { sendWeeklyReportEmail } from "@/lib/reporting";
import {
  claimWeeklyDelivery,
  markWeeklyDeliveryFailed,
  markWeeklyDeliverySent,
} from "@/lib/report-delivery";
import {
  getWeeklyReportPeriod,
  isWeeklyReportDue,
  normalizeReportTimezone,
} from "@/lib/report-period";
import { errorResponse } from "@/lib/http";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type WeeklyRunResult = {
  users: number;
  due: number;
  reports_sent: number;
  reports_skipped: number;
  reports_failed: number;
};

function safeDeliveryError(error: unknown): string {
  if (error instanceof Error && error.message.includes("SMTP is not configured")) {
    return "smtp_not_configured";
  }
  if (error instanceof Error && /pdf|font/i.test(error.message)) {
    return "pdf_render_failed";
  }
  return "email_send_failed";
}

export async function runWeeklyReports(
  reference = new Date(),
  onlyUserIds?: string[],
): Promise<WeeklyRunResult> {
  const service = createServiceClient();
  // This is the trusted scheduler's only all-user query. Every report data,
  // delivery, and auth lookup after it is explicitly scoped to the profile id.
  let profileQuery = service
    .from("profiles")
    .select("id, timezone")
    .eq("weekly_report_enabled", true);
  if (onlyUserIds) profileQuery = profileQuery.in("id", onlyUserIds);
  const { data: profiles, error } = await profileQuery;
  if (error) throw error;

  const result: WeeklyRunResult = {
    users: profiles?.length ?? 0,
    due: 0,
    reports_sent: 0,
    reports_skipped: 0,
    reports_failed: 0,
  };

  for (const profile of profiles ?? []) {
    const userId = profile.id as string;
    const timezone = normalizeReportTimezone(profile.timezone as string | null);
    if (!isWeeklyReportDue(reference, timezone)) continue;
    result.due += 1;

    const period = getWeeklyReportPeriod(reference, timezone);
    let deliveryId: string | undefined;
    try {
      const claim = await claimWeeklyDelivery(service, userId, period, reference);
      if (!claim.claimed || !claim.deliveryId) {
        result.reports_skipped += 1;
        continue;
      }
      deliveryId = claim.deliveryId;

      const report = await getWeeklyReportData(service, userId, period);
      if (!report) {
        await markWeeklyDeliveryFailed(
          service,
          userId,
          deliveryId,
          "missing_account_email",
        );
        result.reports_failed += 1;
        continue;
      }

      let pdf: Buffer;
      try {
        pdf = await generateWeeklyReportPdf(report);
      } catch (pdfError) {
        await markWeeklyDeliveryFailed(
          service,
          userId,
          deliveryId,
          "pdf_render_failed",
        );
        result.reports_failed += 1;
        logError("cron.weekly-report.pdf", pdfError);
        continue;
      }

      const info = await sendWeeklyReportEmail(
        report,
        pdf,
        serverEnv.appUrl ?? "http://localhost:3000",
      );
      await markWeeklyDeliverySent(
        service,
        userId,
        deliveryId,
        info.messageId || null,
        new Date(),
      );
      result.reports_sent += 1;
    } catch (userError) {
      result.reports_failed += 1;
      logError("cron.weekly-report.user", userError);
      if (deliveryId) {
        try {
          await markWeeklyDeliveryFailed(
            service,
            userId,
            deliveryId,
            safeDeliveryError(userError),
          );
        } catch (deliveryError) {
          logError("cron.weekly-report.delivery", deliveryError);
        }
      }
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  if (!safeEqual(header, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await runWeeklyReports()) });
  } catch (error) {
    return errorResponse("cron.weekly-report", error);
  }
}
