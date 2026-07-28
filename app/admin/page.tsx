import AppShell from "@/components/shell/AppShell";
import Badge from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { daysSince, hoursSince } from "@/lib/format";

export const dynamic = "force-dynamic";

type CountResult = { count: number | null };

function countValue(result: CountResult): number {
  return result.count ?? 0;
}

export default async function AdminObservabilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  if (profile?.role !== "admin") {
    return (
      <AppShell active="settings" email={user?.email}>
        <Panel title="Admin access required" tone="warning">
          <p className="text-sm text-muted">This observability dashboard is limited to admin users.</p>
        </Panel>
      </AppShell>
    );
  }

  const service = createServiceClient();
  const [
    profiles,
    plaidItems,
    syncJobs,
    auditLogs,
    notifications,
    recentSyncJobs,
    recentAuditLogs,
    bankHealth,
    lastBackup,
    lastDoneSync,
  ] = await Promise.all([
    service.from("profiles").select("id", { count: "exact", head: true }),
    service.from("plaid_items").select("id", { count: "exact", head: true }),
    service.from("sync_jobs").select("id", { count: "exact", head: true }),
    service.from("audit_logs").select("id", { count: "exact", head: true }),
    service.from("notifications").select("id", { count: "exact", head: true }),
    service
      .from("sync_jobs")
      .select("id, status, source, updated_at")
      .order("updated_at", { ascending: false })
      .limit(6),
    service
      .from("audit_logs")
      .select("id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    service
      .from("plaid_items")
      .select("id, institution_name, status, error_code, updated_at")
      .order("updated_at", { ascending: false })
      .limit(6),
    service
      .from("audit_logs")
      .select("created_at")
      .eq("action", "data_backup")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("sync_jobs")
      .select("updated_at")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const lastBackupAt = (lastBackup.data?.created_at as string | undefined) ?? null;
  const lastSyncAt = (lastDoneSync.data?.updated_at as string | undefined) ?? null;
  const backupAgeDays = daysSince(lastBackupAt);
  const syncAgeHours = hoursSince(lastSyncAt);

  const stats = [
    { label: "Users", value: countValue(profiles) },
    { label: "Banks", value: countValue(plaidItems) },
    { label: "Sync jobs", value: countValue(syncJobs) },
    { label: "Audit events", value: countValue(auditLogs) },
    { label: "Notifications", value: countValue(notifications) },
  ];

  return (
    <AppShell active="settings" email={user?.email}>
      <div>
        <p className="eyebrow">Admin</p>
        <h1 className="display mt-2 text-3xl sm:text-4xl">Observability</h1>
        <p className="mt-2 text-sm text-muted">
          Redacted operational view for sync jobs, bank health, audit events, and alerts.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => (
          <Panel key={stat.label} title={stat.label}>
            <p className="display text-3xl">{stat.value.toLocaleString()}</p>
          </Panel>
        ))}
      </div>

      <Panel title="Operations" eyebrow="Backups and freshness">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-field bg-panel-2 p-3">
            <span className="block text-xs text-muted">Last encrypted backup</span>
            <span className="mt-1 flex items-center gap-2 font-semibold">
              {lastBackupAt ? `${backupAgeDays}d ago` : "never"}
              <Badge tone={backupAgeDays !== null && backupAgeDays <= 35 ? "success" : "danger"}>
                {backupAgeDays !== null && backupAgeDays <= 35 ? "current" : "overdue"}
              </Badge>
            </span>
          </div>
          <div className="rounded-field bg-panel-2 p-3">
            <span className="block text-xs text-muted">Last successful sync</span>
            <span className="mt-1 flex items-center gap-2 font-semibold">
              {lastSyncAt ? `${syncAgeHours}h ago` : "never"}
              <Badge tone={syncAgeHours !== null && syncAgeHours <= 48 ? "success" : "danger"}>
                {syncAgeHours !== null && syncAgeHours <= 48 ? "fresh" : "stale"}
              </Badge>
            </span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Recent sync jobs" eyebrow="Status">
          <div className="space-y-3 text-sm">
            {(recentSyncJobs.data ?? []).map((job) => (
              <div key={job.id} className="flex justify-between gap-4 rounded-field bg-panel-2 p-3">
                <span>
                  <span className="block font-semibold">{job.source ?? "manual"}</span>
                  <span className="block text-xs text-muted">{job.updated_at}</span>
                </span>
                <Badge tone={job.status === "done" ? "success" : job.status === "error" ? "danger" : "warning"}>
                  {job.status}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Bank health" eyebrow="Plaid items">
          <div className="space-y-3 text-sm">
            {(bankHealth.data ?? []).map((item) => (
              <div key={item.id} className="rounded-field bg-panel-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-semibold">{item.institution_name ?? "Institution"}</span>
                    <span className="block text-xs text-muted">{item.error_code ?? "No current error"}</span>
                  </span>
                  <Badge tone={item.status === "active" ? "success" : "warning"}>{item.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent audit events" eyebrow="Redacted">
          <div className="space-y-3 text-sm">
            {(recentAuditLogs.data ?? []).map((event) => (
              <div key={event.id} className="rounded-field bg-panel-2 p-3">
                <span className="block font-semibold">{event.action}</span>
                <span className="block text-xs text-muted">{event.created_at}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
