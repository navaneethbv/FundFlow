import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { getClientIp, writeAudit } from "@/lib/audit";
import { dateKeyInTimezone } from "@/lib/report-period";
import { normalizeScheduledTxn } from "@/lib/scheduled-transactions";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS =
  "id, kind, amount, merchant, scheduled_date, category, notes, account_id, manual_account_id, status";

function serializeRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    amount: Number(row.amount),
    merchant: row.merchant,
    date: row.scheduled_date,
    category: row.category,
    notes: row.notes,
    accountId: row.account_id,
    manualAccountId: row.manual_account_id,
    status: row.status,
  };
}

async function getUserToday(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    return dateKeyInTimezone(new Date(), (profile as { timezone?: string | null } | null)?.timezone);
  } catch {
    return dateKeyInTimezone(new Date(), null);
  }
}

/**
 * Owner-scoped CRUD for one-off scheduled (future-dated) transactions. Rows
 * stay here until the daily sync cron promotes them into the ledger; cancel
 * is a delete, edit rewrites the row while it is still `scheduled`.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const { data, error } = await supabase
      .from("scheduled_transactions")
      .select(SELECT_COLUMNS)
      .eq("user_id", user.id)
      .eq("status", "scheduled")
      .order("scheduled_date", { ascending: true })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ scheduled: (data ?? []).map(serializeRow) });
  } catch (error) {
    return errorResponse("scheduled.list", error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const today = await getUserToday(supabase, user.id);
    const parsed = normalizeScheduledTxn(
      await request.json().catch(() => null),
      today,
    );
    if (!parsed.ok) return badRequest(parsed.error);
    const input = parsed.value;
    const { data, error } = await supabase
      .from("scheduled_transactions")
      .insert({
        user_id: user.id,
        kind: input.kind,
        amount: input.amount,
        merchant: input.merchant,
        scheduled_date: input.date,
        category: input.category,
        notes: input.notes,
        account_id: input.account.source === "plaid" ? input.account.id : null,
        manual_account_id: input.account.source === "manual" ? input.account.id : null,
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    await writeAudit({
      userId: user.id,
      action: "scheduled_transaction_created",
      metadata: { scheduled_id: data.id, scheduled_date: data.scheduled_date },
      ip: getClientIp(request),
    });
    return NextResponse.json({ scheduled: serializeRow(data) }, { status: 201 });
  } catch (error) {
    return errorResponse("scheduled.create", error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = body?.id;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return badRequest("Invalid scheduled transaction id");
    }
    const today = await getUserToday(supabase, user.id);
    const parsed = normalizeScheduledTxn(body, today);
    if (!parsed.ok) return badRequest(parsed.error);
    const input = parsed.value;
    const { data, error } = await supabase
      .from("scheduled_transactions")
      .update({
        kind: input.kind,
        amount: input.amount,
        merchant: input.merchant,
        scheduled_date: input.date,
        category: input.category,
        notes: input.notes,
        account_id: input.account.source === "plaid" ? input.account.id : null,
        manual_account_id: input.account.source === "manual" ? input.account.id : null,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "scheduled")
      .select(SELECT_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest("Scheduled transaction not found");
    await writeAudit({
      userId: user.id,
      action: "scheduled_transaction_updated",
      metadata: { scheduled_id: id, scheduled_date: data.scheduled_date },
      ip: getClientIp(request),
    });
    return NextResponse.json({ scheduled: serializeRow(data) });
  } catch (error) {
    return errorResponse("scheduled.update", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = body?.id;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return badRequest("Invalid scheduled transaction id");
    }
    const { data, error } = await supabase
      .from("scheduled_transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest("Scheduled transaction not found");
    await writeAudit({
      userId: user.id,
      action: "scheduled_transaction_cancelled",
      metadata: { scheduled_id: id },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("scheduled.cancel", error);
  }
}
