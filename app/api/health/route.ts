import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated health check for uptime monitoring and readiness diagnostics.
 * Returns booleans, sync freshness, and latency metrics — never sensitive user data.
 * `degraded` means the app is up but no sync has succeeded in 48h (mirrors the dashboard stale banner).
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  const checkStart = performance.now();

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("sync_jobs")
      .select("updated_at")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const latencyMs = Math.round(performance.now() - checkStart);
    const lastSyncAgeHours = data?.updated_at
      ? Math.round((Date.now() - new Date(data.updated_at as string).getTime()) / 3600000)
      : null;

    const isDegraded = lastSyncAgeHours !== null && lastSyncAgeHours > 48;

    return NextResponse.json(
      {
        ok: true,
        db: true,
        status: isDegraded ? "degraded" : "healthy",
        degraded: isDegraded,
        lastSyncAgeHours,
        responseMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: "connected",
            latencyMs,
          },
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, db: false },
      { status: 503 },
    );
  }
}
