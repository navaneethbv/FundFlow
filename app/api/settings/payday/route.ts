import { resolveViewerToday } from "@/lib/report-period";
import { addDays } from "@/lib/date-utils";
import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { parsePaydaySettings, paydayDates } from "@/lib/payday";
import { writeAudit } from "@/lib/audit";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
async function authorize() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!isFeatureEnabled("paydaySettings"))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (
    !(await checkRateLimit(`payday-settings:${auth.user.id}`, 30, 3600, {
      failClosed: true,
    }))
  )
    return NextResponse.json(
      { error: "Too many changes. Try again later." },
      { status: 429 },
    );
  return auth;
}
export async function POST(request: NextRequest) {
  try {
    const auth = await authorize();
    if (auth instanceof NextResponse) return auth;
    const body = await readJsonBody(request, 2048);
    if (body instanceof NextResponse) return body;
    const settings = parsePaydaySettings(body);
    if (!settings)
      return badRequest(
        "Choose a valid cadence, date, payday days, and positive amount with at most two decimals.",
      );
    const today = await resolveViewerToday(auth.supabase, auth.user.id);
    if (settings.anchorDate < today || settings.anchorDate > addDays(today, 62))
      return badRequest("Choose your next payday within the next 62 days.");
    if (
      paydayDates(settings, settings.anchorDate, 1)[0] !== settings.anchorDate
    )
      return badRequest("The next date must match your chosen payday days.");
    const { error } = await auth.supabase.from("payday_settings").upsert(
      {
        user_id: auth.user.id,
        cadence: settings.cadence,
        anchor_date: settings.anchorDate,
        amount: settings.amount,
        day1: settings.day1,
        day2: settings.day2,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    invalidateDashboardCache(auth.user.id);
    await writeAudit({
      userId: auth.user.id,
      action: "payday_settings_updated",
      metadata: { cadence: settings.cadence },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("payday.save", error);
  }
}
export async function DELETE() {
  try {
    const auth = await authorize();
    if (auth instanceof NextResponse) return auth;
    const { error } = await auth.supabase
      .from("payday_settings")
      .delete()
      .eq("user_id", auth.user.id);
    if (error) throw error;
    invalidateDashboardCache(auth.user.id);
    await writeAudit({
      userId: auth.user.id,
      action: "payday_settings_updated",
      metadata: { cleared: true },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("payday.clear", error);
  }
}
