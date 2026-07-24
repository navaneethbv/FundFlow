import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBillsCalendar, type CalendarBill } from "@/lib/ical";
import { errorResponse } from "@/lib/http";

function normalizeFrequency(
  frequency: string | null,
): CalendarBill["frequency"] {
  const value = (frequency ?? "").toLowerCase();
  if (value.includes("week") && value.includes("bi")) return "biweekly";
  if (value.includes("week")) return "weekly";
  if (value.includes("quarter")) return "quarterly";
  if (value.includes("year")) return "yearly";
  return "monthly";
}

/**
 * iCal feed of upcoming recurring bills and paychecks behind a revocable
 * capability URL (the token is the only credential — calendar apps can't do
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

    const service = createServiceClient();
    const { data: row } = await service
      .from("calendar_tokens")
      .select("user_id, include_amounts")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: streams } = await service
      .from("recurring_streams")
      .select("merchant_name, description, average_amount, last_amount, frequency, stream_type, is_active")
      .eq("user_id", row.user_id)
      .eq("is_active", true);

    const today = new Date().toISOString().slice(0, 10);
    const anchor = `${today.slice(0, 7)}-15`;
    const bills: CalendarBill[] = (streams ?? []).map((stream) => ({
      name: stream.merchant_name ?? stream.description ?? "Recurring",
      amount: Math.abs(Number(stream.last_amount ?? stream.average_amount ?? 0)),
      itemType: stream.stream_type === "inflow" ? "income" : "expense",
      frequency: normalizeFrequency(stream.frequency),
      nextDate: anchor,
    }));

    const ics = buildBillsCalendar({
      bills,
      asOf: today,
      horizonDays: 60,
      includeAmounts: Boolean(row.include_amounts),
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
