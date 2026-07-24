import "server-only";
import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/log";

/**
 * Web push (Bucket 1 deferred → shipped): pushes mirror in-app
 * notifications to subscribed browsers. Entirely optional — without VAPID
 * keys every call is a no-op. Payloads carry title/body only (the same
 * no-PII discipline as emails); tapping the notification opens
 * /notifications. Dead subscriptions (404/410) self-prune.
 */

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string },
): Promise<void> {
  try {
    if (!isPushConfigured()) return;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:admin@fundflow.local",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );

    const service = createServiceClient();
    const { data: subscriptions } = await service
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    for (const subscription of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint as string,
            keys: {
              p256dh: subscription.p256dh as string,
              auth: subscription.auth as string,
            },
          },
          JSON.stringify({ title: payload.title.slice(0, 120), body: payload.body.slice(0, 240) }),
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await service.from("push_subscriptions").delete().eq("id", subscription.id);
        } else {
          logError("push.send", error);
        }
      }
    }
  } catch (error) {
    logError("push", error);
  }
}
