import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeForecastDefaults,
  computeForecastStartingState,
  type ForecastDefaults,
  type ForecastStartingSummary,
} from "@/lib/forecasting";
import { loadCanonicalProjection } from "@/lib/finance-query";

import { financeTotals } from "@/lib/finance-domain";
import { medianOf } from "@/lib/insights";

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
}

/**
 * The per-account net-worth exclusions the accounts page writes into
 * `profiles.dashboard_prefs`. `lib/net-worth.ts` reads the same list; the
 * forecast has to honour it too, or the projection starts from a balance sheet
 * the user already told the app to stop counting.
 */
function readExcludedNetWorthIds(dashboardPrefs: unknown): Set<string> {
  const accountsPage = (dashboardPrefs as Record<string, unknown> | null | undefined)
    ?.accountsPage as { excludedNetWorthIds?: unknown } | undefined;
  return Array.isArray(accountsPage?.excludedNetWorthIds)
    ? new Set(accountsPage.excludedNetWorthIds.filter((id): id is string => typeof id === "string"))
    : new Set<string>();
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

  const [accountsResult, manualResult, profileResult, projection] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, type, subtype, current_balance, iso_currency_code")
      .eq("user_id", userId),
    supabase
      .from("manual_accounts")
      .select("id, account_type, balance, include_in_net_worth")
      .eq("user_id", userId),
    supabase.from("profiles").select("dashboard_prefs").eq("id", userId).maybeSingle(),
    loadCanonicalProjection(supabase, {
      scope: { kind: "mine", ownerUserId: userId },
      window: { start: `${months[0]}-01`, endExclusive: dayAfter(today) },
    }),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (manualResult.error) throw manualResult.error;
  if (profileResult.error) throw profileResult.error;

  const excludedNetWorthIds = readExcludedNetWorthIds(
    (profileResult.data as { dashboard_prefs?: unknown } | null)?.dashboard_prefs,
  );

  const startingState = computeForecastStartingState(
    (accountsResult.data ?? []).map((a) => ({
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

  return { startingState, defaults, monthlyExpenses };
}
