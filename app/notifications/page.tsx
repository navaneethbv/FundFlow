import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import EmailPreferences from "@/components/notifications/EmailPreferences";
import InAppPreferences from "@/components/notifications/InAppPreferences";
import PushSection from "@/components/notifications/PushSection";
import NotificationFeed, { type NotificationRow } from "@/components/notifications/NotificationFeed";
import Badge from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import { formatDate } from "@/lib/format-date";
import { DEFAULT_REPORT_TIMEZONE } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function deliveryStatusTone(status: string): "success" | "danger" | "neutral" {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  const [
    { data: profile },
    { data: alertPreferences },
    { data: notifications },
    { data: deliveries },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("timezone, weekly_report_enabled, daily_digest_email_enabled")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("alert_preferences")
      .select("budget_exceeded, goal_reached, large_transaction, low_cash_forecast, large_transaction_threshold")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("notifications")
      .select("id, type, severity, title, body, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("weekly_report_deliveries")
      .select("period_start, period_end, status, attempted_at, sent_at")
      .eq("user_id", userId)
      .order("attempted_at", { ascending: false })
      .limit(6),
  ]);

  return (
    <AppShell active="notifications" email={user?.email}>
      <PageHeader
        title="Notifications"
        actions={<Badge tone="accent">Private by default</Badge>}
      />
      <p className="max-w-2xl text-sm leading-6 text-muted">
        Control optional email and planning alerts while keeping critical bank and security notices on.
      </p>

      <EmailPreferences
        email={user?.email ?? "your sign-up email"}
        initialWeeklyEnabled={profile?.weekly_report_enabled ?? true}
        initialDailyEnabled={profile?.daily_digest_email_enabled ?? true}
        initialTimezone={profile?.timezone ?? DEFAULT_REPORT_TIMEZONE}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <NotificationFeed initialNotifications={(notifications ?? []) as NotificationRow[]} />
        <div className="space-y-6">
          <InAppPreferences
            initialPreferences={alertPreferences}
            initialThreshold={
              (alertPreferences as { large_transaction_threshold?: number | null } | null)
                ?.large_transaction_threshold ?? null
            }
          />
          <PushSection />
          <Panel title="Weekly delivery history" eyebrow="Last 6 reports">
            <div className="space-y-3 text-sm">
              {(deliveries ?? []).map((delivery) => (
                <div key={`${delivery.period_start}-${delivery.attempted_at}`} className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
                  <span>
                    <span className="block font-semibold">{formatDate(delivery.period_start)} to {formatDate(delivery.period_end)}</span>
                    <span className="block text-xs text-muted">{delivery.sent_at ? `Sent ${formatDate(delivery.sent_at)}` : "Delivery attempted"}</span>
                  </span>
                  <Badge tone={deliveryStatusTone(delivery.status)}>{delivery.status}</Badge>
                </div>
              ))}
              {(deliveries ?? []).length === 0 && <p className="py-4 text-sm text-muted">Your first weekly delivery will appear here after it is prepared.</p>}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
