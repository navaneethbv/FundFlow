import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isLiabilityAccount } from "@/lib/account-balance";
import {
  computeReconciliation,
  parseAccountRef,
  type ReconcileTransaction,
} from "@/lib/reconcile";

const LOOKBACK_DAYS = 120;
const MAX_CLEARED_IDS = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

interface AccountInfo {
  id: string;
  name: string;
  bookBalance: number;
  liability: boolean;
  source: "plaid" | "manual";
}

async function loadOwnedAccount(
  supabase: SupabaseClient,
  userId: string,
  ref: { source: "plaid" | "manual"; id: string },
): Promise<AccountInfo | null> {
  if (ref.source === "plaid") {
    const { data } = await supabase
      .from("accounts")
      .select("id, name, current_balance, type, subtype")
      .eq("id", ref.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      name: data.name ?? "Account",
      bookBalance: Number(data.current_balance ?? 0),
      liability: isLiabilityAccount(data.type, data.subtype),
      source: "plaid",
    };
  }
  const { data } = await supabase
    .from("manual_accounts")
    .select("id, name, balance")
    .eq("id", ref.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name ?? "Account",
    bookBalance: Number(data.balance ?? 0),
    liability: false,
    source: "manual",
  };
}

/**
 * The per-account reconcile workflow (features.md #2): enter a statement's
 * ending balance and date, mark its transactions cleared, and see cleared /
 * outstanding / the difference to the statement. GET returns the working set;
 * POST persists the cleared flags (in annotations, never on synced rows),
 * records the statement, and can append a manual balance-adjustment entry
 * (always audit-logged, never silent).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const ref = parseAccountRef(request.nextUrl.searchParams.get("account"));
    if (!ref) return badRequest("Invalid account reference");
    const statementDate =
      request.nextUrl.searchParams.get("statement_date") ?? isoDaysAgo(0);
    if (!DATE_RE.test(statementDate)) return badRequest("Invalid statement date");
    const statementBalanceParam = request.nextUrl.searchParams.get("statement_balance");

    const account = await loadOwnedAccount(supabase, user.id, ref);
    if (!account) return badRequest("Account not found");

    const accountColumn = ref.source === "plaid" ? "account_id" : "manual_account_id";
    const { data: lastStatement } = await supabase
      .from("account_reconciliations")
      .select("statement_date")
      .eq("user_id", user.id)
      .eq(accountColumn, ref.id)
      .order("statement_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const sinceDate = lastStatement?.statement_date
      ? lastStatement.statement_date as string
      : isoDaysAgo(LOOKBACK_DAYS);

    const { data: txnRows, error: txnError } = await supabase
      .from("transactions")
      .select("id, date, amount, merchant_name, name")
      .eq("user_id", user.id)
      .eq(accountColumn, ref.id)
      .gte("date", sinceDate)
      .lte("date", statementDate)
      .order("date")
      .limit(2000);
    if (txnError) throw txnError;

    const ids = (txnRows ?? []).map((row) => row.id as string);
    const clearedRows = ids.length
      ? await supabase
          .from("transaction_annotations")
          .select("transaction_id, cleared_at")
          .eq("user_id", user.id)
          .in("transaction_id", ids)
          .not("cleared_at", "is", null)
      : { data: [] as never[] };
    const clearedIds = new Set(
      ((clearedRows.data ?? []) as Array<{ transaction_id: string }>).map(
        (row) => row.transaction_id,
      ),
    );

    const transactions: ReconcileTransaction[] = (txnRows ?? []).map((row) => ({
      id: row.id as string,
      date: row.date as string,
      amount: Number(row.amount),
      cleared: clearedIds.has(row.id as string),
      merchant: (row.merchant_name ?? row.name ?? "Unknown") as string,
    }));

    const direction = account.liability ? 1 : -1;
    // statement_balance is optional in the preview; absent, the difference
    // reads 0 and the panel recomputes live once the user types one.
    const statementBalance = Number.isFinite(Number(statementBalanceParam))
      ? Number(statementBalanceParam)
      : account.bookBalance;
    const result = computeReconciliation({
      direction,
      bookBalance: account.bookBalance,
      statementBalance,
      statementDate,
      transactions,
    });

    return NextResponse.json({
      account: { ref: `${ref.source}:${ref.id}`, name: account.name, source: ref.source },
      bookBalance: account.bookBalance,
      direction,
      sinceDate,
      statementDate,
      transactions,
      totals: result,
    });
  } catch (error) {
    return errorResponse("accounts.reconcile.read", error);
  }
}

async function syncClearedStatus(
  supabase: SupabaseClient,
  userId: string,
  accountColumn: string,
  accountId: string,
  statementDate: string,
  clearedIds: string[],
): Promise<NextResponse | null> {
  if (clearedIds.length > 0) {
    const { data: owned, error: ownedError } = await supabase
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .eq(accountColumn, accountId)
      .in("id", clearedIds);
    if (ownedError) throw ownedError;
    if ((owned ?? []).length !== new Set(clearedIds).size) {
      return badRequest("cleared_ids contains transactions outside this account");
    }
    const now = new Date().toISOString();
    const { error: clearError } = await supabase
      .from("transaction_annotations")
      .upsert(
        clearedIds.map((transactionId) => ({
          user_id: userId,
          transaction_id: transactionId,
          cleared_at: now,
        })),
        { onConflict: "user_id,transaction_id", defaultToNull: false },
      );
    if (clearError) throw clearError;
  }

  // Un-clear in-scope rows the user unchecked this round.
  const { data: txnRows } = await supabase
    .from("transactions")
    .select("id")
    .eq("user_id", userId)
    .eq(accountColumn, accountId)
    .gte("date", isoDaysAgo(LOOKBACK_DAYS))
    .lte("date", statementDate)
    .limit(2000);
  const inScopeIds = (txnRows ?? []).map((row) => row.id as string);
  const unmarkIds = inScopeIds.filter((id) => !new Set(clearedIds).has(id));
  if (unmarkIds.length > 0) {
    const { error: unmarkError } = await supabase
      .from("transaction_annotations")
      .update({ cleared_at: null })
      .eq("user_id", userId)
      .in("transaction_id", unmarkIds);
    if (unmarkError) throw unmarkError;
  }
  return null;
}

interface ReconcileParams {
  ref: { source: "plaid" | "manual"; id: string };
  statementDate: string;
  statementBalance: number;
  clearedIds: string[];
  adjustmentNote: string | null;
}

function parseReconcilePayload(body: unknown): { ok: true; params: ReconcileParams } | { ok: false; response: NextResponse } {
  const b = body as Record<string, unknown> | null;
  const ref = parseAccountRef(b?.account);
  if (!ref) return { ok: false, response: badRequest("Invalid account reference") };
  const statementDate = typeof b?.statement_date === "string" ? b.statement_date : "";
  const statementBalance = Number(b?.statement_balance);
  if (!DATE_RE.test(statementDate)) return { ok: false, response: badRequest("Invalid statement date") };
  if (!Number.isFinite(statementBalance)) return { ok: false, response: badRequest("Invalid statement balance") };
  const clearedIds = Array.isArray(b?.cleared_ids)
    ? (b.cleared_ids as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  if (clearedIds.length > MAX_CLEARED_IDS) return { ok: false, response: badRequest("Too many cleared ids") };
  const adjustmentNote =
    typeof b?.adjustment_note === "string" && b.adjustment_note.trim()
      ? b.adjustment_note.trim().slice(0, 120)
      : null;
  return { ok: true, params: { ref, statementDate, statementBalance, clearedIds, adjustmentNote } };
}

async function recordReconciliation(
  supabase: SupabaseClient,
  userId: string,
  params: ReconcileParams,
  adjustmentAmount: number,
): Promise<string> {
  const { data: statement, error: statementError } = await supabase
    .from("account_reconciliations")
    .insert({
      user_id: userId,
      account_id: params.ref.source === "plaid" ? params.ref.id : null,
      manual_account_id: params.ref.source === "manual" ? params.ref.id : null,
      statement_date: params.statementDate,
      statement_balance: params.statementBalance,
    })
    .select("id")
    .single();
  if (statementError) throw statementError;

  if (adjustmentAmount !== 0) {
    const { error: adjustError } = await supabase.from("transactions").insert({
      user_id: userId,
      account_id: params.ref.source === "plaid" ? params.ref.id : null,
      manual_account_id: params.ref.source === "manual" ? params.ref.id : null,
      plaid_transaction_id: `manual-${crypto.randomUUID()}`,
      amount: adjustmentAmount,
      date: params.statementDate,
      name: params.adjustmentNote ?? "Balance adjustment",
      merchant_name: params.adjustmentNote ?? "Balance adjustment",
      pfc_primary: "RECONCILE_ADJUSTMENT",
      source: "manual",
      pending: false,
    });
    if (adjustError) throw adjustError;
  }
  return statement.id;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = await request.json().catch(() => null);
    const parsed = parseReconcilePayload(body);
    if (!parsed.ok) return parsed.response;
    const { params } = parsed;

    const account = await loadOwnedAccount(supabase, user.id, params.ref);
    if (!account) return badRequest("Account not found");
    const accountColumn = params.ref.source === "plaid" ? "account_id" : "manual_account_id";

    const direction = account.liability ? 1 : -1;
    const difference = Math.round((account.bookBalance - params.statementBalance) * 100) / 100;
    const adjustmentAmount = Math.abs(difference) < 0.005 ? 0 : -direction * difference;

    const syncFailure = await syncClearedStatus(
      supabase,
      user.id,
      accountColumn,
      params.ref.id,
      params.statementDate,
      params.clearedIds,
    );
    if (syncFailure) return syncFailure;

    const statementId = await recordReconciliation(supabase, user.id, params, adjustmentAmount);

    await writeAudit({
      userId: user.id,
      action: "account_reconciled",
      metadata: {
        account: `${params.ref.source}:${params.ref.id}`,
        statement_id: statementId,
        statement_date: params.statementDate,
        statement_balance: params.statementBalance,
        cleared_count: params.clearedIds.length,
        difference,
        adjustment_amount: adjustmentAmount,
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({
      ok: true,
      difference,
      adjustment_amount: adjustmentAmount,
      cleared_count: params.clearedIds.length,
    });
  } catch (error) {
    return errorResponse("accounts.reconcile.write", error);
  }
}
