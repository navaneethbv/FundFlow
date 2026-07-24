import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated health check (2.4) for uptime monitoring. Returns only
 * booleans and an age — never user data. `degraded` means the app is up
 * but no sync has succeeded in 48h (mirrors the dashboard's stale banner).
 */
export async function GET() {
  const startedAt = Date.now();
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

    const lastSyncAgeHours = data?.updated_at
      ? Math.round((Date.now() - new Date(data.updated_at as string).getTime()) / 3600000)
      : null;

    return NextResponse.json({
      ok: true,
      db: true,
      degraded: lastSyncAgeHours !== null && lastSyncAgeHours > 48,
      lastSyncAgeHours,
      responseMs: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json(
      { ok: false, db: false },
      { status: 503 },
    );
  }
}
