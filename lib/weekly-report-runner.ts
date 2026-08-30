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
import { logError } from "@/lib/log";
import {
  describeDeliveryError,
  isUndeliverableRecipient,
  UNDELIVERABLE_RECIPIENT_CODE,
} from "@/lib/delivery-error";

export type WeeklyRunResult = {
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
