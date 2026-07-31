import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeForecastDefaults,
  computeForecastStartingState,
  type ForecastDefaults,
  type ForecastStartingState,
} from "@/lib/forecasting";
import { loadCanonicalProjection } from "@/lib/finance-query";

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
  startingState: ForecastStartingState;
  defaults: ForecastDefaults;
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

  const [accountsResult, manualResult, projection] = await Promise.all([
    supabase.from("accounts").select("type, subtype, current_balance").eq("user_id", userId),
    supabase.from("manual_accounts").select("account_type, balance").eq("user_id", userId),
    loadCanonicalProjection(supabase, {
      scope: { kind: "mine", ownerUserId: userId },
      window: { start: `${months[0]}-01`, endExclusive: dayAfter(today) },
    }),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (manualResult.error) throw manualResult.error;

  const startingState = computeForecastStartingState(
    (accountsResult.data ?? []).map((a) => ({
      type: a.type as string | null,
      subtype: a.subtype as string | null,
      balance: Number(a.current_balance ?? 0),
    })),
    (manualResult.data ?? []).map((a) => ({
      accountType: a.account_type as string,
      balance: Number(a.balance ?? 0),
    })),
  );

  const defaults = computeForecastDefaults(projection.transactions, months);

  return { startingState, defaults };
}
