import { TAX_BUCKETS, type BasisAnnotation, type TaxBucket } from "@/lib/investment-provenance";
import { mortgageSchedule, type MortgageTerms } from "@/lib/property-equity";
export type PortfolioKind = "basis" | "tax" | "mortgage";
export type MortgageInput = { liabilityId: string; liabilitySource: "plaid" | "manual"; terms: MortgageTerms };
export interface PortfolioInput { kind: PortfolioKind; id: string; version: number; data: BasisAnnotation | { bucket: TaxBucket } | MortgageInput | null }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function basisInput(data: Record<string, unknown>): BasisAnnotation | string {
  if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount < 0 || data.amount >= 1e12 || Number(data.amount.toFixed(2)) !== data.amount
    || typeof data.quantity !== "number" || !Number.isFinite(data.quantity) || Math.abs(data.quantity) >= 1e12
    || typeof data.source !== "string" || !["manual", "imported", "estimated"].includes(data.source)) return "Enter a valid basis, quantity, and source.";
  return { amount: data.amount, quantity: data.quantity, source: data.source as BasisAnnotation["source"] };
}
function mortgageInput(data: Record<string, unknown>): MortgageInput | string {
  if (!uuid(data.liabilityId) || typeof data.liabilitySource !== "string" || !["plaid", "manual"].includes(data.liabilitySource) || !record(data.terms)) return "Choose an owned liability and enter loan terms.";
  const t = data.terms;
  const terms = { principal: t.principal, annualRate: t.annualRate, paymentAmount: t.paymentAmount, startDate: t.startDate, termMonths: t.termMonths } as MortgageTerms;
  try { mortgageSchedule(terms); } catch { return "Check loan terms: payment must repay principal and interest within 1 to 1200 months."; }
  return { liabilityId: data.liabilityId, liabilitySource: data.liabilitySource as "plaid" | "manual", terms };
}
export function parsePortfolioInput(body: unknown): PortfolioInput | string {
  if (!record(body) || typeof body.kind !== "string" || !["basis", "tax", "mortgage"].includes(body.kind) || !uuid(body.id)
    || !Number.isInteger(body.version) || Number(body.version) < 0 || Number(body.version) >= 2147483646) return "Reload the record before saving.";
  const kind = body.kind as PortfolioKind;
  if (body.data === null) return { kind, id: body.id, version: Number(body.version), data: null };
  if (!record(body.data)) return "Enter configuration details.";
  let data: PortfolioInput["data"] | string;
  if (kind === "basis") data = basisInput(body.data);
  else if (kind === "mortgage") data = mortgageInput(body.data);
  else data = typeof body.data.bucket === "string" && Object.hasOwn(TAX_BUCKETS, body.data.bucket) ? { bucket: body.data.bucket as TaxBucket } : "Choose a tax treatment.";
  return typeof data === "string" ? data : { kind, id: body.id, version: Number(body.version), data };
}
