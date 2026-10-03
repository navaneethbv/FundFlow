import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_MAX_LENGTH = 80;

function validDate(value: string | null): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

/** Reports-only household data: the RPC returns only the written aggregate allowlist. */
export async function GET(request: NextRequest) {
  if (!isFeatureEnabled("householdReportsOnly")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  if (!(await checkRateLimit(`household-aggregates:${user.id}`, 60, 3600, { failClosed: true }))) {
    return NextResponse.json({ error: "Too many aggregate report requests." }, { status: 429 });
  }

  const params = request.nextUrl.searchParams;
  const householdId = params.get("householdId");
  const start = params.get("start");
  const end = params.get("end");
  const category = params.get("category");
  if (!householdId || !validDate(start) || !validDate(end)) {
    return badRequest("householdId, start, and end are required; dates must be YYYY-MM-DD");
  }
  if (end < start) return badRequest("end must not be before start");
  if (category !== null && category.trim().length > CATEGORY_MAX_LENGTH) {
    return badRequest("category is too long");
  }

  try {
    const { data, error } = await supabase.rpc("household_report_aggregates", {
      p_household_id: householdId,
      p_start: start,
      p_end: end,
      p_category: category?.trim() || null,
    });
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "household_report_aggregate_read",
      metadata: { household_id: householdId, start, end, category: category?.trim() || null },
      ip: getClientIp(request),
    });

    return NextResponse.json({ aggregates: data ?? [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse("household.aggregates", error);
  }
}
