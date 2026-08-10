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

const PUSH_SERVICE_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "web.push.apple.com",
  "push.services.mozilla.com",
  "updates.push.services.mozilla.com",
]);

/**
 * Reject push endpoints that are not https URLs on a known push service.
 * Without this an authenticated user could point a subscription at an
 * internal TLS-speaking host and turn notification delivery into an SSRF.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  return PUSH_SERVICE_HOSTS.has(url.hostname);
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
