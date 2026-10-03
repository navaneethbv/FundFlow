import { computeXirr } from "@/lib/xirr";
import { computeTimeWeightedReturn, type Valuation } from "@/lib/investment-performance";
export interface PerformanceSnapshot { account_id: string | null; snapshot_date: string; current_balance: number | null; iso_currency_code: string | null; provenance: string | null }
export interface PerformanceTransaction { account_id: string; date: string; amount: number; txn_subtype: string | null; txn_type: string | null; iso_currency_code: string | null; is_active: boolean }
const EXTERNAL = new Set(["deposit", "withdrawal", "contribution", "distribution"]);
const INTERNAL_CASH = new Set(["dividend", "interest", "qualified dividend", "non-qualified dividend", "long-term capital gain", "short-term capital gain", "tax", "tax withheld", "non-resident tax"]);
function usableTransaction(transaction: PerformanceTransaction): boolean {
  if (transaction.iso_currency_code !== "USD" || !Number.isFinite(transaction.amount)) return false;
  if (transaction.txn_type === "buy" && transaction.txn_subtype === "contribution") return transaction.amount >= 0;
  if (EXTERNAL.has(transaction.txn_subtype ?? "")) return transaction.txn_type === "cash";
  if (["buy", "sell", "fee"].includes(transaction.txn_type ?? "")) return true;
  return transaction.txn_type === "cash" && INTERNAL_CASH.has(transaction.txn_subtype ?? "");
}
function matchedValuations(accountIds: readonly string[], snapshots: readonly PerformanceSnapshot[]) {
  const ids = new Set(accountIds);
  const byDate = new Map<string, Map<string, number>>();
  for (const snapshot of snapshots) {
    if (!snapshot.account_id || !ids.has(snapshot.account_id) || snapshot.iso_currency_code !== "USD" || snapshot.provenance === "estimated") continue;
    if (snapshot.current_balance === null || !Number.isFinite(snapshot.current_balance) || snapshot.current_balance < 0) continue;
    const row = byDate.get(snapshot.snapshot_date) ?? new Map<string, number>();
    row.set(snapshot.account_id, snapshot.current_balance); byDate.set(snapshot.snapshot_date, row);
  }
  return [...byDate].filter(([, values]) => values.size === ids.size).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, value: [...values.values()].reduce((a, b) => a + b, 0) }));
}
export function recordedPerformance(accountIds: readonly string[], snapshots: readonly PerformanceSnapshot[], transactions: readonly PerformanceTransaction[]) {
  const ids = new Set(accountIds);
  const valuations: Valuation[] = matchedValuations(accountIds, snapshots);
  if (valuations.length < 2 || valuations[0].value <= 0) return null;
  const first = valuations[0], last = valuations.at(-1)!;
  const flows = transactions.filter((t) => t.is_active && ids.has(t.account_id) && t.date > first.date && t.date <= last.date);
  if (flows.some((t) => !usableTransaction(t))) return null;
  // Plaid buy/contribution combines cash entering the account with a purchase;
  // its positive amount denotes the purchase, not an investor withdrawal.
  const externalFlows = flows.filter((t) => EXTERNAL.has(t.txn_subtype ?? "")).map((t) => ({ date: t.date, amount: t.txn_type === "buy" ? t.amount : -t.amount }));
  // The existing TWR approximation cannot support a nonpositive interval base.
  if (valuations.slice(1).some((value, index) => valuations[index].value + externalFlows.filter((f) => f.date > valuations[index].date && f.date <= value.date).reduce((sum, f) => sum + f.amount, 0) <= 0)) return null;
  const xirr = computeXirr([{ date: first.date, amount: -first.value }, ...externalFlows.map((flow) => ({ date: flow.date, amount: -flow.amount })), { date: last.date, amount: last.value }]);
  return { valuations, twr: computeTimeWeightedReturn({ valuations, externalFlows }), xirr, start: first.date, end: last.date };
}
