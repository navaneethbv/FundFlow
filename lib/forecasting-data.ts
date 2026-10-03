import "server-only";
import { manualBalanceTable } from "@/lib/manual-asset-flags";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeEarmarkedCapital,
  computeForecastDefaults,
  computeForecastStartingState,
  type ForecastDefaults,
  type ForecastStartingSummary,
} from "@/lib/forecasting";
import { loadCanonicalProjection } from "@/lib/finance-query";

import { financeTotals } from "@/lib/finance-domain";
import { medianOf, splitEssentialsByMonth } from "@/lib/insights";
import { readExcludedNetWorthIds } from "@/lib/net-worth-inputs";
import { dedupeRelinkedAccounts } from "@/lib/relinked-accounts";
import { groupKeyFor } from "@/lib/accounts-page";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { loadTaxOverrides } from "@/lib/portfolio-data";
import { summarizeTaxBuckets } from "@/lib/investment-provenance";

const TRAILING_MONTHS = 6;

function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function trailingMonths(today: string, count: number): string[] {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export interface ForecastPageData {
  startingState: ForecastStartingSummary;
  defaults: ForecastDefaults;
  monthlyExpenses: number;
  essentialMonthlyExpenses: number;
  earmarkedCapital: ReturnType<typeof computeEarmarkedCapital>;
  taxSummary?: ReturnType<typeof summarizeTaxBuckets>;
}

/**
 * Owner-only: unlike Cash Flow or Budget, a household member's forecast is
 * about their own share of decisions (savings rate, debt payoff), not a
 * shared total, so this does not offer a household scope.
 */
export async function loadForecastPageData(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<ForecastPageData> {
  const months = trailingMonths(today, TRAILING_MONTHS);

  const [accountsResult, manualResult, profileResult, projection, goalsResult, linksResult, eventsResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, plaid_item_id, name, mask, type, subtype, current_balance, iso_currency_code, updated_at")
      .eq("user_id", userId),
    supabase
      .from(manualBalanceTable())
      .select("id, account_type, balance, include_in_net_worth")
      .eq("user_id", userId),
    supabase.from("profiles").select("dashboard_prefs").eq("id", userId).maybeSingle(),
    loadCanonicalProjection(supabase, {
      scope: { kind: "mine", ownerUserId: userId },
      window: { start: `${months[0]}-01`, endExclusive: dayAfter(today) },
    }),
    supabase
      .from("goals")
      .select("id,name,image_slug,saved_amount,spending_reduces,target_amount")
      .eq("user_id", userId),
    supabase
      .from("goal_accounts")
      .select("goal_id,account_id,allocated_amount,use_entire_balance")
      .eq("user_id", userId),
    supabase
      .from("goal_progress_events")
      .select("goal_id,amount")
      .eq("user_id", userId),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (manualResult.error) throw manualResult.error;
  if (profileResult.error) throw profileResult.error;
  if (goalsResult.error) throw goalsResult.error;
  if (linksResult.error) throw linksResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const excludedNetWorthIds = readExcludedNetWorthIds(
    (profileResult.data as { dashboard_prefs?: unknown } | null)?.dashboard_prefs,
  );

  const startingState = computeForecastStartingState(
    dedupeRelinkedAccounts(accountsResult.data ?? []).map((a) => ({
      type: a.type as string | null,
      subtype: a.subtype as string | null,
      balance: a.current_balance === null || a.current_balance === undefined
        ? null
        : Number(a.current_balance),
      isoCurrencyCode: (a.iso_currency_code ?? null) as string | null,
      includeInNetWorth: !excludedNetWorthIds.has(a.id as string),
    })),
    (manualResult.data ?? []).map((a) => ({
      accountType: a.account_type as string,
      balance: a.balance === null || a.balance === undefined ? null : Number(a.balance),
      // Only an explicit `false` excludes. Coercing an absent column to false
      // would silently zero the whole starting point.
      includeInNetWorth:
        a.include_in_net_worth !== false && !excludedNetWorthIds.has(a.id as string),
    })),
  );

  const defaults = computeForecastDefaults(projection.transactions, months);

  const byMonth = new Map<string, typeof projection.transactions>();
  for (const t of projection.transactions) {
    const m = t.date.slice(0, 7);
    if (!months.includes(m)) continue;
    const list = byMonth.get(m) ?? [];
    list.push(t);
    byMonth.set(m, list);
  }
  const monthlyExpensesList = months
    .map((m) => financeTotals(byMonth.get(m) ?? []).expenses)
    .filter((e) => e > 0);
  const monthlyExpenses = monthlyExpensesList.length > 0 ? Math.round(medianOf(monthlyExpensesList)) : 0;
  const essentialByMonth = splitEssentialsByMonth(
    projection.transactions
      .filter((transaction) => transaction.flow === "expense" && transaction.signedAmount > 0)
      .map((transaction) => ({
        month: transaction.date.slice(0, 7),
        pfcPrimary: transaction.groupKey,
        pfcDetailed: transaction.categoryKey,
        amount: transaction.signedAmount,
      })),
    months,
  );
  const essentialMonthlyExpenses = essentialByMonth
    .filter((row) => row.month !== today.slice(0, 7) && row.essentials > 0)
    .map((row) => row.essentials);
  const typicalEssentialMonthlyExpenses = essentialMonthlyExpenses.length > 0
    ? Math.round(medianOf(essentialMonthlyExpenses))
    : 0;

  const earmarkedCapital = computeEarmarkedCapital(
    (goalsResult.data ?? []).map((row) => ({
      id: row.id as string,
      name: String(row.name ?? ""),
      imageSlug: (row.image_slug as string | null) ?? null,
      savedAmount: Number(row.saved_amount ?? 0),
      spendingReduces: Boolean(row.spending_reduces),
      targetAmount: Number(row.target_amount ?? 0),
    })),
    (linksResult.data ?? []).map((row) => ({
      goalId: row.goal_id as string,
      accountId: row.account_id as string,
      allocatedAmount: row.allocated_amount == null ? null : Number(row.allocated_amount),
      useEntireBalance: Boolean(row.use_entire_balance),
    })),
    (accountsResult.data ?? []).map((row) => ({
      id: row.id as string,
      balance: row.current_balance == null ? null : Number(row.current_balance),
    })),
    (eventsResult.data ?? []).map((row) => ({
      goalId: row.goal_id as string,
      amount: Number(row.amount ?? 0),
    })),
  );

  if (!isFeatureEnabled("investmentTaxBuckets")) return { startingState, defaults, monthlyExpenses, essentialMonthlyExpenses: typicalEssentialMonthlyExpenses, earmarkedCapital };
  const taxAccounts = [
    ...dedupeRelinkedAccounts(accountsResult.data ?? []).filter((a) => !excludedNetWorthIds.has(a.id) && groupKeyFor(a.type, a.subtype) === "investment").map((a) => ({
      id: a.id as string, source: "plaid" as const, subtype: a.subtype as string | null,
      balance: a.current_balance == null ? null : Number(a.current_balance), currency: a.iso_currency_code as string | null,
    })),
    ...(manualResult.data ?? []).filter((a) => !excludedNetWorthIds.has(a.id) && a.include_in_net_worth !== false && a.account_type === "investment").map((a) => ({
      id: a.id as string, source: "manual" as const, subtype: null, balance: a.balance == null ? null : Number(a.balance), currency: "USD",
    })),
  ];
  return { startingState, defaults, monthlyExpenses, essentialMonthlyExpenses: typicalEssentialMonthlyExpenses, earmarkedCapital, taxSummary: summarizeTaxBuckets(taxAccounts, await loadTaxOverrides(supabase, userId)) };
}
