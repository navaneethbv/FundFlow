import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { safeEqual } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { syncAllForUser } from "@/lib/sync";
import { refreshRecurringForUser } from "@/lib/recurring";
import { errorResponse } from "@/lib/http";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled daily sync for every user with active bank connections.
 * Protected by CRON_SECRET: Vercel Cron sends "Authorization: Bearer <secret>"
 * when the CRON_SECRET env var is set.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  if (!safeEqual(header, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("plaid_items")
      .select("user_id")
      .eq("status", "active");
    if (error) throw error;

    const userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];

    let synced = 0;
    for (const userId of userIds) {
      try {
        await syncAllForUser(userId);
        await refreshRecurringForUser(userId);
        synced += 1;
      } catch (err) {
        logError("cron.sync.user", err);
      }
    }

    return NextResponse.json({ ok: true, users: userIds.length, synced });
  } catch (error) {
    return errorResponse("cron.sync", error);
  }
}
