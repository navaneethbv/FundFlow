import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import { sendWeeklyReportEmail } from "@/lib/reporting";
import {
  claimWeeklyDelivery,
  markWeeklyDeliveryFailed,
  markWeeklyDeliverySent,
  markWeeklyDeliverySkipped,
} from "@/lib/report-delivery";
import {
  getWeeklyReportPeriod,
  isWeeklyReportDue,
  normalizeReportTimezone,
} from "@/lib/report-period";
import { errorResponse, requireCronAuth } from "@/lib/http";
import { logError } from "@/lib/log";
import { alertCronFailure } from "@/lib/cron-alert";
import {
  describeDeliveryError,
  isUndeliverableRecipient,
  redactEmails,
  UNDELIVERABLE_RECIPIENT_CODE,
} from "@/lib/delivery-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type WeeklyRunResult = {
  users: number;
  due: number;
  reports_sent: number;
  reports_skipped: number;
  reports_failed: number;
  first_error?: string;
};

type WeeklyDeliveryOutcome = {
  status: "sent" | "skipped" | "failed";
  error?: string;
};

async function runSingleWeeklyReport(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  reference: Date,
  timezone: string,
): Promise<WeeklyDeliveryOutcome> {
  const period = getWeeklyReportPeriod(reference, timezone);
  let deliveryId: string | undefined;
  try {
    const claim = await claimWeeklyDelivery(service, userId, period, reference);
    if (!claim.claimed || !claim.deliveryId) return { status: "skipped" };
    deliveryId = claim.deliveryId;
    const report = await getWeeklyReportData(service, userId, period);
    if (!report) {
      await markWeeklyDeliveryFailed(service, userId, deliveryId, "missing_account_email");
      return { status: "failed", error: "missing_account_email" };
    }
    if (isUndeliverableRecipient(report.userEmail)) {
      await markWeeklyDeliverySkipped(
        service,
        userId,
        deliveryId,
        UNDELIVERABLE_RECIPIENT_CODE,
      );
      return { status: "skipped" };
    }
    let pdf: Buffer;
    try {
      pdf = await generateWeeklyReportPdf(report);
    } catch (pdfError) {
      await markWeeklyDeliveryFailed(service, userId, deliveryId, "pdf_render_failed");
      logError("cron.weekly-report.pdf", pdfError);
      return { status: "failed", error: "pdf_render_failed" };
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
    return { status: "sent" };
  } catch (userError) {
    const error = describeDeliveryError(userError);
    logError("cron.weekly-report.user", userError);
    if (deliveryId) {
      try {
        await markWeeklyDeliveryFailed(service, userId, deliveryId, error);
      } catch (deliveryError) {
        logError("cron.weekly-report.delivery", deliveryError);
      }
    }
    return { status: "failed", error };
  }
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
    const outcome = await runSingleWeeklyReport(service, userId, reference, timezone);
    if (outcome.status === "sent") result.reports_sent += 1;
    if (outcome.status === "skipped") result.reports_skipped += 1;
    if (outcome.status === "failed") {
      result.reports_failed += 1;
      result.first_error ??= outcome.error;
    }
  }

  return result;
}

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
