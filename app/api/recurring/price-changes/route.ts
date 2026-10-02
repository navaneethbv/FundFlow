import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { detectConfirmedPriceChange } from "@/lib/recurring-price-changes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  if (!isFeatureEnabled("recurringPriceHistory")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { data, error } = await auth.supabase
    .from("recurring_price_changes")
    .select("id,recurring_stream_id,effective_date,previous_amount,new_amount,created_at")
    .eq("user_id", auth.user.id)
    .order("effective_date", { ascending: false })
    .limit(100);
  if (error) return errorResponse("recurring.price-changes.list", error);
  return NextResponse.json({ changes: data ?? [] });
}

export async function POST(request: Request) {
  if (!isFeatureEnabled("recurringPriceHistory")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!(await checkRateLimit(`recurring_price_change:${auth.user.id}`, 30, 3600))) {
    return NextResponse.json({ error: "Too many price-change requests" }, { status: 429 });
  }
  try {
    const body = (await request.json().catch(() => null)) as { stream_id?: unknown } | null;
    if (typeof body?.stream_id !== "string" || !UUID.test(body.stream_id)) return badRequest("Invalid stream_id");
    const { data: stream, error: streamError } = await auth.supabase
      .from("recurring_streams")
      .select("id")
      .eq("id", body.stream_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (streamError) throw streamError;
    if (!stream) return NextResponse.json({ error: "Recurring stream not found" }, { status: 404 });
    const { data: joins, error: joinError } = await auth.supabase
      .from("recurring_stream_transactions")
      .select("transaction_id")
      .eq("recurring_stream_id", body.stream_id)
      .eq("user_id", auth.user.id);
    if (joinError) throw joinError;
    const transactionIds = (joins ?? []).map((row) => String(row.transaction_id));
    if (transactionIds.length < 3) return NextResponse.json({ recorded: false, reason: "insufficient_history" });
    const { data: transactions, error: transactionError } = await auth.supabase
      .from("transactions")
      .select("id,date,amount")
      .eq("user_id", auth.user.id)
      .in("id", transactionIds);
    if (transactionError) throw transactionError;
    const change = detectConfirmedPriceChange((transactions ?? []).map((row) => ({ date: String(row.date), amount: Math.abs(Number(row.amount)) })));
    if (!change) return NextResponse.json({ recorded: false, reason: "not_confirmed" });
    const service = createServiceClient();
    const { data: existing, error: existingError } = await service
      .from("recurring_price_changes")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("recurring_stream_id", body.stream_id)
      .eq("effective_date", change.effectiveDate)
      .eq("new_amount", change.newAmount)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return NextResponse.json({ recorded: false, reason: "already_recorded" });
    const { error: insertError } = await service.from("recurring_price_changes").insert({
      user_id: auth.user.id,
      recurring_stream_id: body.stream_id,
      effective_date: change.effectiveDate,
      previous_amount: change.previousAmount,
      new_amount: change.newAmount,
    });
    if (insertError) throw insertError;
    await writeAudit({ userId: auth.user.id, action: "recurring_price_change_recorded", metadata: { stream_id: body.stream_id, effective_date: change.effectiveDate } });
    return NextResponse.json({ recorded: true, change });
  } catch (error) {
    return errorResponse("recurring.price-changes.record", error);
  }
}
