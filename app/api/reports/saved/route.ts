import { NextResponse, type NextRequest } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { parseReportFilters, REPORT_TABS, type ReportTab } from "@/lib/reports";

/**
 * Saved report definitions (Phase 6). Writes go through the cookie-bound
 * client, so the owner-only RLS policy on `saved_reports` applies; the explicit
 * `user_id` filters are belt-and-braces, not the only guard.
 *
 * The filter payload is validated by `parseReportFilters` on the way in as well
 * as on the way out. Storing an unvalidated blob would mean a hand-crafted
 * request could park arbitrary jsonb in the row and have the Reports page read
 * it back later.
 */

export const MAX_SAVED_REPORTS = 50;
const MAX_NAME_LENGTH = 80;

function parseName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function parseReportType(value: unknown): ReportTab | null {
  return typeof value === "string" && (REPORT_TABS as readonly string[]).includes(value)
    ? (value as ReportTab)
    : null;
}

/** Postgres unique_violation — the (user_id, name) constraint. */
function isDuplicateName(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!(await checkRateLimit(`saved-report:${user.id}`, 30, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      reportType?: unknown;
      filters?: unknown;
    } | null;

    const name = parseName(body?.name);
    if (!name) return badRequest(`name is required (1-${MAX_NAME_LENGTH} characters)`);
    const reportType = parseReportType(body?.reportType);
    if (!reportType) return badRequest("reportType must be cash_flow, spending, or income");
    const filters = parseReportFilters(body?.filters);
    if (!filters) return badRequest("filters did not match the saved-report schema");

    // Bound the row count per user; a saved report is a named view, not a log.
    const { count, error: countError } = await supabase
      .from("saved_reports")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_SAVED_REPORTS) {
      return NextResponse.json(
        { error: `You can save up to ${MAX_SAVED_REPORTS} reports. Delete one first.` },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from("saved_reports")
      .insert({
        user_id: user.id,
        name,
        report_type: reportType,
        filters,
      })
      .select("id, name, report_type, filters")
      .single();
    if (isDuplicateName(error)) {
      return NextResponse.json(
        { error: "You already have a saved report with that name." },
        { status: 409 },
      );
    }
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "saved_report_created",
      metadata: { report_type: reportType },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true, report: data });
  } catch (error) {
    return errorResponse("reports.saved.post", error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!(await checkRateLimit(`saved-report:${user.id}`, 30, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      name?: unknown;
      filters?: unknown;
    } | null;
    if (typeof body?.id !== "string" || !body.id.trim()) {
      return badRequest("id is required");
    }

    const patch: { name?: string; filters?: unknown } = {};
    if (body.name !== undefined) {
      const name = parseName(body.name);
      if (!name) return badRequest(`name must be 1-${MAX_NAME_LENGTH} characters`);
      patch.name = name;
    }
    if (body.filters !== undefined) {
      const filters = parseReportFilters(body.filters);
      if (!filters) return badRequest("filters did not match the saved-report schema");
      patch.filters = filters;
    }
    if (Object.keys(patch).length === 0) {
      return badRequest("nothing to update");
    }

    const { data, error } = await supabase
      .from("saved_reports")
      .update(patch)
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("id, name, report_type, filters")
      .maybeSingle();
    if (isDuplicateName(error)) {
      return NextResponse.json(
        { error: "You already have a saved report with that name." },
        { status: 409 },
      );
    }
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    await writeAudit({
      userId: user.id,
      action: "saved_report_updated",
      metadata: { renamed: patch.name !== undefined },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true, report: data });
  } catch (error) {
    return errorResponse("reports.saved.patch", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) return badRequest("id is required");

    const { data, error } = await supabase
      .from("saved_reports")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    await writeAudit({
      userId: user.id,
      action: "saved_report_deleted",
      metadata: {},
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("reports.saved.delete", error);
  }
}
