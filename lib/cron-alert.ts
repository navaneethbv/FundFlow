import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { withCronDelivery } from "@/lib/cron-delivery";
import { sendCronAlertEmail, type CronAlertSummary } from "@/lib/reporting";
import { sendPushToUser } from "@/lib/push";
import { logError } from "@/lib/log";

export type { CronAlertSummary } from "@/lib/reporting";

/** Sends at most one successful email per cron per 24 hours. Failed sends can retry. */
export async function alertCronFailure(cronName: string, summary: CronAlertSummary): Promise<void> {
  try {
    const service = createServiceClient();
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    await withCronDelivery(service, `cron-alert:${cronName}`, null, cutoff, async () => {
      const { data: admins, error } = await service.from("profiles")
        .select("id").eq("role", "admin").order("id").limit(1);
      if (error) throw error;
      const adminId = admins?.[0]?.id as string | undefined;
      if (!adminId) {
        logError("cron-alert.no-admin", new Error(`no admin profile to alert for ${cronName}`));
        return null;
      }

      try {
        const { data: userData, error: userError } = await service.auth.admin.getUserById(adminId);
        if (userError) throw userError;
        const email = userData?.user?.email;
        if (!email) {
          logError("cron-alert.no-email", new Error(`admin profile has no email for ${cronName}`));
          return null;
        }
        await sendCronAlertEmail(email, cronName, summary);
        return new Date().toISOString();
      } catch (error) {
        await sendPushToUser(adminId, { title: "Scheduled job needs attention", body: `${cronName} reported a failure.` });
        throw error;
      }
    });
  } catch (error) {
    logError("cron-alert.send", error);
  }
}
