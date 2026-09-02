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

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = await request.json().catch(() => null);
    const ref = parseAccountRef(body?.account);
    if (!ref) return badRequest("Invalid account reference");
    const statementDate = typeof body?.statement_date === "string" ? body.statement_date : "";
    const statementBalance = Number(body?.statement_balance);
    if (!DATE_RE.test(statementDate)) return badRequest("Invalid statement date");
    if (!Number.isFinite(statementBalance)) return badRequest("Invalid statement balance");
    const clearedIds = Array.isArray(body?.cleared_ids)
      ? (body.cleared_ids as unknown[]).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];
    if (clearedIds.length > MAX_CLEARED_IDS) return badRequest("Too many cleared ids");
    const adjustmentNote =
      typeof body?.adjustment_note === "string" && body.adjustment_note.trim()
        ? body.adjustment_note.trim().slice(0, 120)
        : null;

    const account = await loadOwnedAccount(supabase, user.id, ref);
    if (!account) return badRequest("Account not found");
    const accountColumn = ref.source === "plaid" ? "account_id" : "manual_account_id";

    // The adjustment entry moves the ledger toward the statement: the bank is
    // right, the ledger gets a correction. A ledger row shifts the balance by
    // direction × amount, so hitting a gap of `difference` needs
    // amount = −direction × difference.
    const direction = account.liability ? 1 : -1;
    const difference = Math.round((account.bookBalance - statementBalance) * 100) / 100;
    const adjustmentAmount = Math.abs(difference) < 0.005 ? 0 : -direction * difference;

    if (clearedIds.length > 0) {
      // Verify every cleared id belongs to this user AND this account.
      const { data: owned, error: ownedError } = await supabase
        .from("transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq(accountColumn, ref.id)
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
            user_id: user.id,
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
      .eq("user_id", user.id)
      .eq(accountColumn, ref.id)
      .gte("date", isoDaysAgo(LOOKBACK_DAYS))
      .lte("date", statementDate)
      .limit(2000);
    const inScopeIds = (txnRows ?? []).map((row) => row.id as string);
    const unmarkIds = inScopeIds.filter((id) => !new Set(clearedIds).has(id));
    if (unmarkIds.length > 0) {
      const { error: unmarkError } = await supabase
        .from("transaction_annotations")
        .update({ cleared_at: null })
        .eq("user_id", user.id)
        .in("transaction_id", unmarkIds);
      if (unmarkError) throw unmarkError;
    }

    const { data: statement, error: statementError } = await supabase
      .from("account_reconciliations")
      .insert({
        user_id: user.id,
        account_id: ref.source === "plaid" ? ref.id : null,
        manual_account_id: ref.source === "manual" ? ref.id : null,
        statement_date: statementDate,
        statement_balance: statementBalance,
      })
      .select("id")
      .single();
    if (statementError) throw statementError;

    if (adjustmentAmount !== 0) {
      const { error: adjustError } = await supabase.from("transactions").insert({
        user_id: user.id,
        account_id: ref.source === "plaid" ? ref.id : null,
        manual_account_id: ref.source === "manual" ? ref.id : null,
        plaid_transaction_id: `manual-${crypto.randomUUID()}`,
        amount: adjustmentAmount,
        date: statementDate,
        name: adjustmentNote ?? "Balance adjustment",
        merchant_name: adjustmentNote ?? "Balance adjustment",
        pfc_primary: "RECONCILE_ADJUSTMENT",
        source: "manual",
        pending: false,
      });
      if (adjustError) throw adjustError;
    }

    await writeAudit({
      userId: user.id,
      action: "account_reconciled",
      metadata: {
        account: `${ref.source}:${ref.id}`,
        statement_id: statement.id,
        statement_date: statementDate,
        statement_balance: statementBalance,
        cleared_count: clearedIds.length,
        difference,
        adjustment_amount: adjustmentAmount,
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({
      ok: true,
      difference,
      adjustment_amount: adjustmentAmount,
      cleared_count: clearedIds.length,
    });
  } catch (error) {
    return errorResponse("accounts.reconcile.write", error);
  }
}
