import type { SupabaseClient } from "@supabase/supabase-js";
import Panel from "@/components/ui/Panel";
import PortfolioAnnotationForm from "@/components/investments/PortfolioAnnotationForm";
import PerformanceChart from "@/components/investments/PerformanceChart";
import TaxBucketSummary from "@/components/investments/TaxBucketSummary";
import { loadBasisAnnotations, loadBasisHoldings, loadTaxOverrides, portfolioRows, PortfolioReadLimitError } from "@/lib/portfolio-data";
import { resolveBasis, summarizeBasis, summarizeTaxBuckets, taxBucketFor, TAX_BUCKETS } from "@/lib/investment-provenance";
import { recordedPerformance, type PerformanceSnapshot, type PerformanceTransaction } from "@/lib/recorded-performance";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency } from "@/lib/format";
import type { InvestmentAccountSummary } from "@/lib/investments";
type Props = { client: SupabaseClient; userId: string; accounts: InvestmentAccountSummary[] };

export async function BasisAnalysis({ client, userId, accounts }: Readonly<Props>) {
  if (!isFeatureEnabled("investmentBasis")) return null;
  const [records, annotations] = await Promise.all([loadBasisHoldings(client, userId), loadBasisAnnotations(client, userId)]);
  const rows = records.filter((h) => h.is_active && accounts.some((a) => a.id === (h.account_id ?? h.manual_account_id) && a.currency === "USD") && h.securities?.iso_currency_code === "USD").map((h) => ({
    id: h.id, value: h.institution_value, quantity: h.quantity, reportedBasis: h.cost_basis, annotation: annotations.find((a) => a.holding_id === h.id) ?? null, name: `${h.securities?.name ?? "Holding"} (${accounts.find((a) => a.id === (h.account_id ?? h.manual_account_id))?.name ?? "Account"})`,
  }));
  const summary = summarizeBasis(rows);
  return <Panel title="Cost basis and coverage"><p className="mb-3 text-sm">{summary.coveragePct === null ? "Coverage unavailable" : `${summary.coveragePct.toFixed(1)}% basis coverage`} · {summary.partial ? "Partial gain" : "Gain on covered holdings"}: <span data-money>{summary.coveredHoldings ? formatCurrency(summary.gain) : "Unavailable"}</span></p>
    <p className="mb-4 text-xs text-muted">Owner USD holdings only, weighted by known market value. Cash and accounts without holdings are outside this denominator. {records.filter((h) => h.is_active).length - rows.length} holding(s) excluded for currency/account scope. {summary.missingValues} missing value(s), {summary.missingBasis} missing basis, {summary.estimated} estimated basis. Quantity changes invalidate annotations; reported basis is never overwritten.</p>
    <ul className="space-y-4">{rows.map((row) => { const basis = resolveBasis(row); return <li key={row.id} className="rounded-md border border-border p-3"><p className="mb-2 text-sm">{row.name}: <span data-money>{basis ? formatCurrency(basis.amount) : "Unknown"}</span> ({basis?.source ?? "missing or stale"})</p>
      <details><summary className="cursor-pointer text-sm underline">Edit basis for {row.name}</summary><div className="mt-3"><PortfolioAnnotationForm key={row.annotation?.version ?? 0} name={row.name} quantity={row.quantity} initial={{ kind: "basis", id: row.id, version: row.annotation?.version ?? 0, data: row.annotation }} /></div></details></li>; })}</ul>
  </Panel>;
}
export async function TaxAnalysis({ client, userId, accounts }: Readonly<Props>) {
  if (!isFeatureEnabled("investmentTaxBuckets")) return null;
  const overrides = await loadTaxOverrides(client, userId);
  return <Panel title="Tax-treatment allocation"><TaxBucketSummary summary={summarizeTaxBuckets(accounts.map((a) => ({ ...a, currency: a.currencyKnown === false ? null : a.currency })), overrides)} /><ul className="mt-4 space-y-3">{accounts.map((account) => {
    const treatment = taxBucketFor(account, overrides);
    return <li key={account.id}><details><summary className="cursor-pointer text-sm">{account.name}: {TAX_BUCKETS[treatment.bucket]} ({treatment.source})</summary><div className="mt-3"><PortfolioAnnotationForm key={treatment.version} name={account.name} initial={{ kind: "tax", id: account.id, version: treatment.version, data: { bucket: treatment.bucket } }} /></div></details></li>;
  })}</ul></Panel>;
}
async function loadRecordedPerformance(client: SupabaseClient, userId: string, ids: string[]) {
  try {
  const [snapshots, transactions] = await Promise.all([
    portfolioRows<PerformanceSnapshot>(client, userId, "account_balance_snapshots", "id,account_id,snapshot_date,current_balance,iso_currency_code,provenance", "id", { column: "account_id", value: ids }),
    portfolioRows<PerformanceTransaction>(client, userId, "investment_transactions", "id,account_id,date,amount,txn_type,txn_subtype,iso_currency_code,is_active", "id", { column: "account_id", value: ids }),
  ]);
    return recordedPerformance(ids, snapshots, transactions);
  } catch (error) {
    if (error instanceof PortfolioReadLimitError) return null;
    throw error;
  }
}
export async function RecordedPerformance({ client, userId, accounts }: Readonly<Props>) {
  if (!isFeatureEnabled("investmentXirr") || !isFeatureEnabled("historyProvenance")) return null;
  const eligible = accounts.filter((a) => a.source === "plaid" && a.currency === "USD" && a.currencyKnown !== false);
  const result = eligible.length ? await loadRecordedPerformance(client, userId, eligible.map((a) => a.id)) : null;
  return <Panel title="Recorded account performance"><p className="mb-3 text-xs text-muted">{eligible.length} owned USD provider account(s); {accounts.length - eligible.length} manual or non-USD account(s) excluded. Both returns use the same complete-account observation dates and recorded external flows. Provider history may omit earlier or unreported flows.</p>
    {result ? <><p className="mb-2 text-sm">{result.start} to {result.end}</p><PerformanceChart balanceHistory={result.valuations} returns={result.twr} currency="USD" returnTitle="Cumulative time-weighted return" />
      <p className="mt-3 text-sm">Annualized money-weighted return (XIRR): <span data-money>{result.xirr ? `${(result.xirr.rate * 100).toFixed(2)}%` : "Unavailable"}</span></p>
      {result.xirr?.multipleRootsPossible && <p className="text-sm text-muted">These cash flows may have multiple roots. This is one calculated rate, not a unique return.</p>}</> : <p className="text-sm">Return unavailable: two complete USD observations and usable cash flows are required, within the 10,000-row read limit.</p>}
    <details className="mt-3 text-xs text-muted"><summary>Return methodology</summary><p>Time-weighted return uses the existing interval-flow approximation and is cumulative, not annualized. XIRR uses actual days divided by 365, opening value as an investment, and closing value as proceeds. Opening-day flows are already in opening value. Newton starts at 10%; if it fails, bisection uses the sign-changing bracket nearest 10% on a fixed logarithmic grid. Supported rates are greater than -99.9999% and at most 100,000,000%. A missing root is unavailable.</p></details>
  </Panel>;
}
