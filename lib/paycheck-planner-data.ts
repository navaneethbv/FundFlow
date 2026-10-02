import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  dedupeRelinkedAccounts,
  type RelinkedAccountIdentity,
} from "@/lib/relinked-accounts";
import { TRANSFER_GROUPS } from "@/lib/finance-domain";
import { addMonths } from "@/lib/date-utils";
import { loadPaydaySettings } from "@/lib/payday-data";
import { paydayDates } from "@/lib/payday";
import { loadRecurringInputs } from "@/lib/recurring-data";
import { expandStreamsForMonth } from "@/lib/recurring-page";
import { planPaychecks, type PaycheckBill } from "@/lib/paycheck-planner";

interface CashAccount {
  id: string;
  type: string | null;
  current_balance: number | string | null;
  iso_currency_code: string | null;
}
/** Missing accounts/balances are unknown, never inferred to be an empty wallet. */
export function planningCash(accounts: CashAccount[]): number | null {
  const cash = accounts.filter((account) => account.type === "depository");
  if (
    !cash.length ||
    cash.some(
      (account) =>
        account.current_balance === null ||
        !Number.isFinite(Number(account.current_balance)),
    )
  )
    return null;
  return (
    Math.round(
      cash.reduce((sum, account) => sum + Number(account.current_balance), 0) *
        100,
    ) / 100
  );
}
interface CardBill {
  account_id: string;
  statement_balance: number | string | null;
  due_date: string | null;
}
interface ScheduledBill {
  id: string;
  merchant: string;
  scheduled_date: string;
  amount: number | string;
}
function collectBills(
  recurring: Awaited<ReturnType<typeof loadRecurringInputs>>,
  bankAccounts: CashAccount[],
  suppressedIds: Set<string>,
  cards: CardBill[],
  scheduled: ScheduledBill[],
  today: string,
  through: string,
): PaycheckBill[] {
  const creditIds = new Set(
    bankAccounts
      .filter((account) => account.type === "credit")
      .map((account) => account.id),
  );
  // Reserve card statement payments once, not the card purchases they settle.
  const directIds = new Set(
    recurring.streamRows
      .filter(
        (row) =>
          !creditIds.has(row.account_id ?? "") &&
          !suppressedIds.has(row.account_id ?? "") &&
          !TRANSFER_GROUPS.has(row.category ?? ""),
      )
      .map((row) => row.id),
  );
  const streams = recurring.streamInputs.filter((stream) =>
    directIds.has(stream.id),
  );
  const bills: PaycheckBill[] = [];
  for (
    let month = `${today.slice(0, 7)}-01`;
    month <= through;
    month = addMonths(month, 1)
  ) {
    const occurrences = expandStreamsForMonth(
      streams,
      recurring.manualInputs.filter(
        (row) => !TRANSFER_GROUPS.has(row.category ?? ""),
      ),
      month.slice(0, 7),
      today,
    ).occurrences;
    bills.push(
      ...occurrences
        .filter(
          (row) => !row.isIncome && row.status !== "complete" && row.amount > 0,
        )
        .map((row) => ({
          id: `${row.source}:${row.sourceId}:${row.dueDate}`,
          name: row.merchant,
          dueDate: row.dueDate,
          amount: row.amount,
        })),
    );
  }
  for (const card of cards) {
    if (
      !suppressedIds.has(card.account_id) &&
      card.due_date &&
      Number(card.statement_balance) > 0
    )
      bills.push({
        id: `card:${card.account_id}:${card.due_date}`,
        name: "Card statement",
        dueDate: card.due_date,
        amount: Number(card.statement_balance),
      });
  }
  for (const row of scheduled) {
    if (Number(row.amount) > 0)
      bills.push({
        id: `scheduled:${row.id}`,
        name: row.merchant,
        dueDate: row.scheduled_date,
        amount: Number(row.amount),
      });
  }
  return bills;
}
export async function loadPaycheckPlan(
  client: SupabaseClient,
  userId: string,
  today: string,
) {
  if (!isFeatureEnabled("paycheckPlanner")) return null;
  const settings = await loadPaydaySettings(client, userId);
  if (!settings) return { configured: false as const };
  const through = paydayDates(settings, today)[3]!;
  const [recurring, accounts, cards, scheduled] = await Promise.all([
    loadRecurringInputs(client, userId),
    client
      .from("accounts")
      .select(
        "id,user_id,plaid_item_id,name,mask,type,subtype,updated_at,current_balance,iso_currency_code",
      )
      .eq("user_id", userId)
      .limit(1000),
    client
      .from("credit_card_bills")
      .select("account_id,statement_balance,due_date")
      .eq("user_id", userId)
      .limit(1000),
    client
      .from("scheduled_transactions")
      .select("id,merchant,scheduled_date,amount")
      .eq("user_id", userId)
      .eq("kind", "debit")
      .eq("status", "scheduled")
      .lt("scheduled_date", through)
      .limit(1000),
  ]);
  for (const result of [accounts, cards, scheduled]) {
    if (result.error) throw result.error;
    if ((result.data?.length ?? 0) >= 1000)
      throw new Error("Too many planning inputs to load completely");
  }
  const bankAccounts = dedupeRelinkedAccounts(
    (accounts.data ?? []) as (CashAccount & RelinkedAccountIdentity)[],
  );
  if (
    bankAccounts.some(
      (account) => (account.iso_currency_code ?? "USD").toUpperCase() !== "USD",
    )
  )
    return { configured: true as const, currencyUnsupported: true as const };
  const activeIds = new Set(bankAccounts.map((account) => account.id));
  const suppressedIds = new Set(
    ((accounts.data ?? []) as CashAccount[])
      .filter((account) => !activeIds.has(account.id))
      .map((account) => account.id),
  );
  const bills = collectBills(
    recurring,
    bankAccounts,
    suppressedIds,
    (cards.data ?? []) as CardBill[],
    (scheduled.data ?? []) as ScheduledBill[],
    today,
    through,
  );
  const cash = planningCash(bankAccounts);
  return {
    configured: true as const,
    currencyUnsupported: false as const,
    periods: planPaychecks({ today, settings, cash, bills }),
    cash,
  };
}
