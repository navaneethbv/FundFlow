import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBillsCalendar, type CalendarBill } from "@/lib/ical";
import { errorResponse } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveViewerToday } from "@/lib/report-period";
import { loadRecurringInputs } from "@/lib/recurring-data";
import { expandStreamsForMonth } from "@/lib/recurring-page";
import { addDays, addMonths } from "@/lib/date-utils";
import { writeAudit } from "@/lib/audit";

/**
 * iCal feed of upcoming recurring bills and paychecks behind a revocable
 * capability URL (the token is the only credential, calendar apps can't do
 * cookie auth). Amounts appear only when the token was minted with them.
 * The service client is required here (no session), so every query is
 * scoped to the token row's user_id explicitly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!token || token.length < 20) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // The capability token is the only credential, so the feed is rate-limited
    // by token to blunt brute-force / token-harvesting scans.
    if (!(await checkRateLimit(`calendar-feed:${tokenHash}`, 60, 3600))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const service = createServiceClient();
    const { data: row, error: tokenError } = await service
      .from("calendar_tokens")
      .select("user_id, include_amounts")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (tokenError) throw tokenError;
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const today = await resolveViewerToday(service, row.user_id as string);
    const end = addDays(today, 60);
    const bills = await loadCalendarBills(service, row.user_id, today, end);

    const ics = buildBillsCalendar({
      bills,
      asOf: today,
      horizonDays: 60,
      includeAmounts: Boolean(row.include_amounts),
    });

    await writeAudit({
      userId: row.user_id,
      action: "calendar_feed_read",
      metadata: { include_amounts: Boolean(row.include_amounts) },
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("calendar.feed", error);
  }
}

async function loadCalendarBills(
  service: ReturnType<typeof createServiceClient>, userId: string, today: string, end: string,
): Promise<CalendarBill[]> {
  const { streamInputs, manualInputs } = await loadRecurringInputs(service, userId);
  const bills: CalendarBill[] = [];
  for (let month = `${today.slice(0, 7)}-01`; month <= end; month = addMonths(month, 1)) {
    const { occurrences } = expandStreamsForMonth(streamInputs, manualInputs, month.slice(0, 7), today);
    for (const occurrence of occurrences) {
      bills.push({ id: `${occurrence.source}-${occurrence.sourceId}`, name: occurrence.merchant,
        amount: occurrence.amount, itemType: occurrence.isIncome ? "income" : "expense",
        frequency: "once", nextDate: occurrence.dueDate });
    }
  }
  bills.push(...await loadScheduledBills(service, userId, today, end));

  return bills;
}

async function loadScheduledBills(
  service: ReturnType<typeof createServiceClient>, userId: string, today: string, end: string,
): Promise<CalendarBill[]> {
  const bills: CalendarBill[] = [];
  // Scheduled entries are a separate source and must also be explicitly owner-scoped.
  for (let offset = 0; ; offset += 500) {
    const { data: scheduled, error } = await service.from("scheduled_transactions")
      .select("id,merchant,amount,kind,scheduled_date").eq("user_id", userId)
      .eq("status", "scheduled").gte("scheduled_date", today).lte("scheduled_date", end)
      .order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const entry of scheduled ?? []) bills.push({ id: `scheduled-${entry.id}`, name: entry.merchant,
      amount: Math.abs(Number(entry.amount)), itemType: entry.kind === "credit" ? "income" : "expense",
      frequency: "once", nextDate: entry.scheduled_date });
    if ((scheduled ?? []).length < 500) break;
  }

  return bills;
}
