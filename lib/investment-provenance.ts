export const TAX_BUCKETS = {
  taxable: "Taxable", deferred: "Tax deferred", roth: "Roth", hsa: "Health savings", education: "Education savings", unknown: "Unknown",
} as const;
export type TaxBucket = keyof typeof TAX_BUCKETS;
export type BasisSource = "reported" | "manual" | "imported" | "estimated";
export interface BasisAnnotation { amount: number; quantity: number; source: Exclude<BasisSource, "reported"> }
export interface BasisHolding { id: string; value: number | null; quantity: number | null; reportedBasis: number | null; annotation?: BasisAnnotation | null }

export function inferTaxBucket(subtype: string | null): TaxBucket {
  const value = subtype?.toLowerCase().replaceAll(/[^a-z0-9]/g, "") ?? "";
  if (["roth", "roth401k", "roth403b", "roth457b", "rothpension", "rothprofitsharingplan", "roththriftsavingsplan"].includes(value)) return "roth";
  if (["401a", "401k", "403b", "457b", "ira", "sepira", "simpleira", "sarsep", "keogh", "pension", "profitsharingplan", "thriftsavingsplan"].includes(value)) return "deferred";
  if (value === "hsa") return "hsa";
  if (["529", "educationsavingsaccount"].includes(value)) return "education";
  if (value === "brokerage") return "taxable";
  return "unknown";
}

const nonnegative = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

export function resolveBasis(holding: BasisHolding): { amount: number; source: BasisSource } | null {
  const annotation = holding.annotation;
  const valid = annotation && nonnegative(annotation.amount) && annotation.quantity === holding.quantity;
  if (valid && annotation.source !== "estimated") return { amount: annotation.amount, source: annotation.source };
  if (nonnegative(holding.reportedBasis)) return { amount: holding.reportedBasis, source: "reported" };
  return valid ? { amount: annotation.amount, source: annotation.source } : null;
}

/** Coverage is market-value weighted for holdings with a usable value, never
 * account balances without holdings. Unknown values are separately counted. */
export function summarizeBasis(holdings: readonly BasisHolding[]) {
  let totalValue = 0, coveredValue = 0, basis = 0, missingValues = 0, missingBasis = 0, estimated = 0, coveredHoldings = 0;
  for (const holding of holdings) {
    if (!nonnegative(holding.value)) { missingValues++; continue; }
    totalValue += holding.value;
    const resolved = resolveBasis(holding);
    if (!resolved) { missingBasis++; continue; }
    coveredValue += holding.value;
    coveredHoldings++;
    basis += resolved.amount;
    if (resolved.source === "estimated") estimated++;
  }
  return { totalValue, coveredValue, basis, gain: coveredValue - basis,
    coveragePct: totalValue > 0 ? coveredValue / totalValue * 100 : null,
    partial: missingValues > 0 || missingBasis > 0, missingValues, missingBasis, estimated, coveredHoldings };
}

export interface TaxAccount { id: string; source: "plaid" | "manual"; subtype: string | null; balance: number | null; currency: string | null }
export interface TaxOverride { account_id: string | null; manual_account_id: string | null; bucket: TaxBucket; version: number }
export function taxBucketFor(account: TaxAccount, overrides: readonly TaxOverride[]) {
  const override = overrides.find((item) => (account.source === "plaid" ? item.account_id : item.manual_account_id) === account.id);
  return { bucket: override?.bucket ?? inferTaxBucket(account.subtype), source: override ? "User override" : "Account subtype", version: override?.version ?? 0 };
}
export function summarizeTaxBuckets(accounts: readonly TaxAccount[], overrides: readonly TaxOverride[]) {
  const buckets: Record<TaxBucket, number> = { taxable: 0, deferred: 0, roth: 0, hsa: 0, education: 0, unknown: 0 };
  let unavailable = 0;
  for (const account of accounts) {
    if (account.currency !== "USD" || account.balance === null || !Number.isFinite(account.balance)) { unavailable++; continue; }
    buckets[taxBucketFor(account, overrides).bucket] += account.balance;
  }
  return { buckets, unavailable };
}
