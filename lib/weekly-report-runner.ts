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

type WeeklyProfile = { id: string; timezone: string | null };

const PROFILE_PAGE_SIZE = 1_000;
const PROFILE_ID_CHUNK_SIZE = 500;

async function loadWeeklyProfiles(
  service: ReturnType<typeof createServiceClient>,
  onlyUserIds?: string[],
): Promise<WeeklyProfile[]> {
  const uniqueUserIds = onlyUserIds ? [...new Set(onlyUserIds)] : null;
  if (uniqueUserIds?.length === 0) return [];
  const idChunks: Array<string[] | null> = uniqueUserIds
    ? Array.from(
        { length: Math.ceil(uniqueUserIds.length / PROFILE_ID_CHUNK_SIZE) },
        (_, index) => uniqueUserIds.slice(
          index * PROFILE_ID_CHUNK_SIZE,
          (index + 1) * PROFILE_ID_CHUNK_SIZE,
        ),
      )
    : [null];
  const profiles: WeeklyProfile[] = [];

  for (const idChunk of idChunks) {
    for (let page = 0; ; page += 1) {
      const from = page * PROFILE_PAGE_SIZE;
      let query = service
        .from("profiles")
        .select("id, timezone")
        .eq("weekly_report_enabled", true);
      if (idChunk) query = query.in("id", idChunk);
      const { data, error } = await query
        .order("id")
        .range(from, from + PROFILE_PAGE_SIZE - 1);
      if (error) throw error;
      const batch = (data ?? []) as WeeklyProfile[];
      profiles.push(...batch);
      if (batch.length < PROFILE_PAGE_SIZE) break;
    }
  }
  return profiles;
}

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
  const profiles = await loadWeeklyProfiles(service, onlyUserIds);

  const result: WeeklyRunResult = {
    users: profiles.length,
    due: 0,
    reports_sent: 0,
    reports_skipped: 0,
    reports_failed: 0,
  };

  for (const profile of profiles) {
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
