import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendCronAlertEmail, type CronAlertSummary } from "@/lib/reporting";
import { logError } from "@/lib/log";

export type { CronAlertSummary } from "@/lib/reporting";

const ALERT_WINDOW_SECONDS = 24 * 3600;

/**
 * Email the admin that a cron run failed, wholly or for some users.
 * Best-effort: never throws into the cron handler. Deduped to one alert per
 * cron name per 24h via the fixed-window limiter; the limiter fails open,
 * which here means at worst an extra email, never a missed cron run.
 */
export async function alertCronFailure(
  cronName: string,
  summary: CronAlertSummary,
): Promise<void> {
  try {
    const allowed = await checkRateLimit(
      `cron-alert:${cronName}`,
      1,
      ALERT_WINDOW_SECONDS,
    );
    if (!allowed) return;

    const service = createServiceClient();
    // Trusted scheduler context: the admin lookup is the only cross-user
    // query, and it selects nothing but the admin's own profile id.
    const { data: admins, error } = await service
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .limit(1);
    if (error) throw error;
    const adminId = admins?.[0]?.id as string | undefined;
    if (!adminId) {
      logError(
        "cron-alert.no-admin",
        new Error(`no admin profile to alert for ${cronName}`),
      );
      return;
    }

    const { data: userData } = await service.auth.admin.getUserById(adminId);
    const email = userData?.user?.email;
    if (!email) {
      logError(
        "cron-alert.no-email",
        new Error(`admin profile has no email for ${cronName}`),
      );
      return;
    }

    await sendCronAlertEmail(email, cronName, summary);
  } catch (error) {
    logError("cron-alert.send", error);
  }
}
