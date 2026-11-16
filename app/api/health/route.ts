import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

const HEALTH_CACHE_MS = 30_000;
const HOUR_MS = 3_600_000;
const SCHEDULER_THRESHOLDS = {
  "scheduler:weekly-report": 26 * HOUR_MS,
  "scheduler:backup": 35 * 24 * HOUR_MS,
};
let cachedHealth: { until: number; status: number; payload: object } | undefined;
let pendingHealth: Promise<{ status: number; payload: object }> | undefined;

function schedulerStatus(age: number | null, limit: number): "unknown" | "stale" | "healthy" {
  if (age === null) return "unknown";
  return age > limit ? "stale" : "healthy";
}

async function checkHealth() {
  const startedAt = Date.now();
  const checkStart = performance.now();
  try {
    const service = createServiceClient();
    const [sync, scheduler] = await Promise.all([
      service.from("sync_jobs").select("updated_at").eq("status", "done")
        .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      service.from("cron_delivery_windows").select("delivery_key,sent_through")
        .in("delivery_key", Object.keys(SCHEDULER_THRESHOLDS)).is("user_id", null),
    ]);
    if (sync.error) throw sync.error;
    if (scheduler.error) throw scheduler.error;

    const latencyMs = Math.round(performance.now() - checkStart);
    const lastSyncAgeHours = sync.data?.updated_at
      ? Math.round((Date.now() - Date.parse(sync.data.updated_at as string)) / HOUR_MS) : null;
    const now = Date.now();
    const checks = Object.fromEntries(Object.entries(SCHEDULER_THRESHOLDS).map(([key, limit]) => {
      const seen = scheduler.data?.find((run) => run.delivery_key === key)?.sent_through;
      const age = seen ? now - Date.parse(seen) : null;
      return [key.slice("scheduler:".length), {
        status: schedulerStatus(age, limit),
        ageHours: age === null ? null : Math.round(age / HOUR_MS),
      }];
    }));
    const degraded = (lastSyncAgeHours !== null && lastSyncAgeHours > 48) ||
      Object.values(checks).some((check) => check.status === "stale");
    return { status: 200, payload: {
      ok: true, db: true, status: degraded ? "degraded" : "healthy", degraded, lastSyncAgeHours,
      responseMs: now - startedAt, timestamp: new Date(now).toISOString(),
      checks: { database: { status: "connected", latencyMs }, scheduler: checks },
    } };
  } catch (error) {
    logError("health.check", error);
    return { status: 503, payload: { ok: false, db: false } };
  }
}

/** Unauthenticated uptime check with no per-user data. */
export async function GET(): Promise<NextResponse> {
  if (!cachedHealth || Date.now() >= cachedHealth.until) {
    pendingHealth ??= checkHealth();
    const result = await pendingHealth;
    cachedHealth = { ...result, until: Date.now() + HEALTH_CACHE_MS };
    pendingHealth = undefined;
  }
  return NextResponse.json(cachedHealth.payload, {
    status: cachedHealth.status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
