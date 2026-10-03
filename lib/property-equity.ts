import { buildAmortizationSchedule, type AmortizationResult } from "@/lib/amortization";
import { validFinancialDate } from "@/lib/xirr";
export interface MortgageTerms { principal: number; annualRate: number; paymentAmount: number; startDate: string; termMonths: number }
export interface LiabilityObservation { date: string; balance: number; provenance: "observed" | "manual" | "estimated" }
export function mortgageSchedule(terms: MortgageTerms): AmortizationResult {
  if (!validFinancialDate(terms.startDate) || terms.startDate < "1900-01-01" || terms.startDate > "2200-12-31" || !Number.isInteger(terms.termMonths) || terms.termMonths < 1 || terms.termMonths > 1200
    || !Number.isFinite(terms.annualRate) || terms.annualRate < 0 || terms.annualRate > 100
    || !Number.isFinite(terms.principal) || terms.principal <= 0 || terms.principal >= 1e12
    || !Number.isFinite(terms.paymentAmount) || terms.paymentAmount <= 0 || terms.paymentAmount >= 1e12) throw new Error("Invalid mortgage terms");
  return buildAmortizationSchedule({ ...terms, ratePeriods: [{ start: terms.startDate, annualRate: terms.annualRate }], periodCap: terms.termMonths });
}

/** Exact-date observations take precedence. Never carry a future observation
 * backwards, and never write a computed equity into account/net-worth data. */
export function propertyEquity(date: string, ownedValue: number, terms: MortgageTerms, schedule: AmortizationResult, observations: readonly LiabilityObservation[]) {
  const observed = observations.find((row) => row.date === date && row.provenance !== "estimated" && Number.isFinite(row.balance));
  if (observed) return { equity: ownedValue - observed.balance, balance: observed.balance, provenance: observed.provenance };
  if (date < terms.startDate) return null;
  const row = schedule.rows.findLast((item) => item.date <= date);
  const balance = row?.closingPrincipal ?? terms.principal;
  return { equity: ownedValue - balance, balance, provenance: "estimated" as const };
}

/** Current presentation retains the newest available lender/manual balance,
 * explicitly dated, rather than replacing a stale observation with a model. */
export function currentPropertyEquity(today: string, ownedValue: number, terms: MortgageTerms, schedule: AmortizationResult, observations: readonly LiabilityObservation[], liveObservation?: LiabilityObservation | null) {
  // A current account read is not a historical lookup. Its UTC capture date
  // can be tomorrow relative to the viewer's local calendar without being future data.
  const live = liveObservation?.provenance !== "estimated" && Number.isFinite(liveObservation?.balance) ? liveObservation : null;
  const latest = live ?? observations.filter((row) => row.date <= today && row.provenance !== "estimated" && Number.isFinite(row.balance)).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latest) return { equity: ownedValue - latest.balance, balance: latest.balance, provenance: latest.provenance, asOf: latest.date };
  const estimate = propertyEquity(today, ownedValue, terms, schedule, []);
  return estimate ? { ...estimate, asOf: today } : null;
}
