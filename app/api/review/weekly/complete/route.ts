import { NextResponse, type NextRequest } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { mondayOf } from "@/lib/weekly-review";
import { resolveViewerToday } from "@/lib/report-period";
import { createServiceClient } from "@/lib/supabase/service";
import { getClientIp, writeAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("weeklyReview")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!(await checkRateLimit(`weekly-review:${auth.user.id}`, 10, 3600, { failClosed: true }))) {
    return NextResponse.json({ error: "Too many completion attempts. Please try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => null) as { complete?: unknown } | null;
  if (body?.complete !== true) return badRequest("complete must be true");
  try {
    const today = await resolveViewerToday(auth.supabase, auth.user.id);
    const service = createServiceClient();
    const { data, error } = await service.rpc("complete_weekly_review", {
      p_user_id: auth.user.id,
      p_week_start: mondayOf(today),
    });
    if (error) throw error;
    await writeAudit({
      userId: auth.user.id,
      action: "weekly_review_completed",
      metadata: { week_start: mondayOf(today) },
      ip: getClientIp(request),
    });
    const result = data as { weekStart?: string; streak?: number; alreadyComplete?: boolean } | null;
    return NextResponse.json({
      ok: true,
      weekStart: result?.weekStart ?? mondayOf(today),
      streak: result?.streak ?? 0,
      alreadyComplete: result?.alreadyComplete ?? false,
    });
  } catch (error) {
    return errorResponse("review.weekly.complete", error);
  }
}
