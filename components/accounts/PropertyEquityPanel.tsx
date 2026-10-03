import type { SupabaseClient } from "@supabase/supabase-js";
import Panel from "@/components/ui/Panel";
import PortfolioAnnotationForm from "@/components/investments/PortfolioAnnotationForm";
import { loadMortgageData } from "@/lib/portfolio-data";
import { mortgageSchedule, propertyEquity, currentPropertyEquity } from "@/lib/property-equity";
import { formatCurrency } from "@/lib/format";
import { isFeatureEnabled } from "@/lib/feature-flags";
export default async function PropertyEquityPanel({ client, userId, propertyId, today, history }: Readonly<{ client: SupabaseClient; userId: string; propertyId: string; today: string; history: Array<{ valuation_date: string; owned_value: number; provenance: string }> }>) {
  if (!isFeatureEnabled("mortgageEquity") || !isFeatureEnabled("amortizationEngine")) return null;
  const { link, options, observations, currentObservation } = await loadMortgageData(client, userId, propertyId);
  const schedule = link ? mortgageSchedule(link.terms) : null;
  const latestProperty = history.find((value) => value.valuation_date <= today);
  const current = link && schedule && latestProperty ? currentPropertyEquity(today, Number(latestProperty.owned_value), link.terms, schedule, observations, currentObservation) : null;
  const liabilityId = link?.liability_account_id ?? link?.liability_manual_account_id;
  const liabilitySource = link?.liability_account_id ? "plaid" : "manual";
  return <Panel title="Mortgage-linked equity"><p className="mb-4 text-sm text-muted">Presentation only: property and liability remain separate in net worth, with the debt counted once. The liability is your recorded obligation; property ownership percentage does not rescale it. Enter principal and interest only, excluding escrow, insurance, and fees. Estimates use fixed-rate monthly payments; exact-date lender or manual balances take precedence.</p>
    {current && latestProperty && <p className="mb-4 text-sm">Latest available equity: <span data-money>{formatCurrency(current.equity)}</span>. Property value as of {latestProperty.valuation_date} ({latestProperty.provenance}); loan captured {current.asOf} UTC ({current.provenance}). Capture dates may differ from lender valuation dates. Different dates are not a synchronized valuation.</p>}
    <PortfolioAnnotationForm key={link?.version ?? 0} name="Property mortgage" liabilities={options} today={today} initial={{ kind: "mortgage", id: propertyId, version: link?.version ?? 0, data: link && liabilityId ? { liabilityId, liabilitySource, terms: link.terms } : null }} />
    {link && schedule && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption>Equity at recorded property valuations (latest 100)</caption><thead><tr>{["Date", "Owned value", "Loan balance", "Equity", "Sources"].map((label) => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{history.map((value) => { const result = propertyEquity(value.valuation_date, Number(value.owned_value), link.terms, schedule, observations); return <tr key={value.valuation_date}><td className="p-2">{value.valuation_date}</td><td data-money className="p-2">{formatCurrency(Number(value.owned_value))}</td><td data-money className="p-2">{result ? formatCurrency(result.balance) : "Unavailable"}</td><td data-money className="p-2">{result ? formatCurrency(result.equity) : "Unavailable"}</td><td className="p-2">Property: {value.provenance}; loan: {result?.provenance ?? "before schedule"}</td></tr>; })}</tbody></table></div>}
  </Panel>;
}
