import { describe, expect, it } from "vitest";
import { computeXirr, validFinancialDate } from "@/lib/xirr";
import { inferTaxBucket, resolveBasis, summarizeBasis, summarizeTaxBuckets, taxBucketFor, type BasisHolding } from "@/lib/investment-provenance";
import { mortgageSchedule, propertyEquity, currentPropertyEquity } from "@/lib/property-equity";
import { parsePortfolioInput } from "@/lib/portfolio-input";
import { recordedPerformance, type PerformanceSnapshot, type PerformanceTransaction } from "@/lib/recorded-performance";
import { netWorthContribution } from "@/lib/account-balance";

describe("XIRR", () => {
  const year = [{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: 1100 }];
  it("annualizes actual days and is scale/order invariant", () => {
    expect(computeXirr(year)?.rate).toBeCloseTo(0.1, 8);
    for (const scale of [0.001, 1e9]) expect(computeXirr([...year].reverse().map((f) => ({ ...f, amount: f.amount * scale })))?.rate).toBeCloseTo(0.1, 8);
    expect(computeXirr([{ date: "2025-01-01", amount: -100 }, { date: "2027-01-01", amount: 121 }])?.rate).toBeCloseTo(0.1, 8);
  });
  it("handles withdrawals, losses, leap years, same-day netting, and zero return", () => {
    expect(computeXirr([{ ...year[0], amount: -100 }, { ...year[1], amount: 50 }])?.rate).toBeCloseTo(-0.5, 8);
    expect(computeXirr([{ ...year[0], amount: -100 }, { ...year[1], amount: 100 }])?.rate).toBeCloseTo(0, 8);
    expect(computeXirr([...year, { ...year[1], amount: 50 }, { ...year[1], amount: -50 }])?.rate).toBeCloseTo(0.1, 8);
    expect(computeXirr([{ date: "2024-01-01", amount: -100 }, { date: "2025-01-01", amount: 110 }])?.rate).toBeCloseTo(Math.pow(1.1, 365 / 366) - 1, 8);
  });
  it("falls back to a bracket when Newton leaves the domain", () => {
    const result = computeXirr([{ ...year[0], amount: -1000 }, { ...year[1], amount: 1 }]);
    expect(result?.method).toBe("bisection"); expect(result?.rate).toBeCloseTo(-0.999, 7);
  });
  it("warns on nonconventional flows without claiming a unique root", () => {
    const result = computeXirr([{ date: "2023-01-01", amount: -100 }, { date: "2024-01-01", amount: 230 }, { date: "2024-12-31", amount: -132 }]);
    expect(result?.multipleRootsPossible).toBe(true); expect(result?.rate).toBeCloseTo(0.1, 8);
  });
  it("returns unavailable for invalid or unsupported series", () => {
    for (const flows of [[], [year[0]], [year[0], year[0]], [year[1], year[1]], [{ ...year[0], amount: Number.NaN }, year[1]], [{ ...year[0], date: "2025-02-30" }, year[1]], [{ ...year[0], amount: 0 }, { ...year[1], amount: 0 }], Array.from({ length: 10001 }, () => year[0]), [{ ...year[0], amount: -Number.MAX_VALUE }, { ...year[1], amount: Number.MAX_VALUE }], [{ ...year[0], amount: -1 }, { ...year[1], amount: 1e9 }]]) expect(computeXirr(flows)).toBeNull();
    expect(validFinancialDate(null)).toBe(false); expect(validFinancialDate("2024-02-29")).toBe(true);
  });
});
describe("basis provenance", () => {
  const holding: BasisHolding = { id: "h", value: 100, quantity: 2, reportedBasis: 50 };
  it("resolves manual/imported before reported, estimated after reported, and rejects stale quantities", () => {
    for (const source of ["manual", "imported"] as const) expect(resolveBasis({ ...holding, annotation: { amount: 0, quantity: 2, source } })).toEqual({ amount: 0, source });
    expect(resolveBasis({ ...holding, annotation: { amount: 80, quantity: 2, source: "estimated" } })).toEqual({ amount: 50, source: "reported" });
    expect(resolveBasis({ ...holding, reportedBasis: null, annotation: { amount: 80, quantity: 2, source: "estimated" } })).toEqual({ amount: 80, source: "estimated" });
    expect(resolveBasis({ ...holding, reportedBasis: null, annotation: { amount: 80, quantity: 1, source: "manual" } })).toBeNull();
    expect(resolveBasis({ ...holding, reportedBasis: -1 })).toBeNull();
  });
  it("reports partial gains and market-value-weighted coverage without treating absent basis as zero", () => {
    expect(summarizeBasis([holding, { ...holding, id: "missing", value: 300, reportedBasis: null }, { ...holding, id: "unknown", value: null }])).toMatchObject({ coveragePct: 25, gain: 50, coveredValue: 100, totalValue: 400, partial: true, missingValues: 1, missingBasis: 1 });
    expect(summarizeBasis([])).toMatchObject({ coveragePct: null, partial: false });
    expect(summarizeBasis([{ ...holding, reportedBasis: null, annotation: { amount: 20, quantity: 2, source: "estimated" } }]).estimated).toBe(1);
  });
});
describe("tax treatments", () => {
  it.each([["401(k)", "deferred"], ["403B", "deferred"], ["Roth 401k", "roth"], ["hsa", "hsa"], ["529", "education"], ["brokerage", "taxable"], ["RRSP", "unknown"], [null, "unknown"], ["retirement", "unknown"]])("classifies %s without using account names", (subtype, expected) => { expect(inferTaxBucket(subtype)).toBe(expected); });
  it("applies explicit overrides and retains unknown and excluded currency counts", () => {
    const accounts = [{ id: "a", source: "plaid" as const, subtype: "ira", balance: 100, currency: "USD" }, { id: "m", source: "manual" as const, subtype: null, balance: 200, currency: "USD" }];
    const overrides = [{ account_id: "a", manual_account_id: null, bucket: "roth" as const, version: 2 }];
    expect(taxBucketFor(accounts[0], overrides)).toEqual({ bucket: "roth", source: "User override", version: 2 });
    expect(summarizeTaxBuckets([...accounts, { ...accounts[0], id: "foreign", currency: "CAD" }, { ...accounts[0], id: "empty", balance: null }], overrides)).toEqual({ buckets: { taxable: 0, deferred: 0, roth: 100, hsa: 0, education: 0, unknown: 200 }, unavailable: 2 });
  });
});
describe("property equity", () => {
  const terms = { principal: 1200, annualRate: 0, paymentAmount: 100, startDate: "2025-01-31", termMonths: 12 };
  it("prefers exact dated observations, estimates historical balances, and does not double count net worth", () => {
    const schedule = mortgageSchedule(terms);
    expect(propertyEquity("2025-02-28", 5000, terms, schedule, [])).toEqual({ equity: 4000, balance: 1000, provenance: "estimated" });
    expect(propertyEquity("2025-02-28", 5000, terms, schedule, [{ date: "2025-02-28", balance: 900, provenance: "observed" }])).toEqual({ equity: 4100, balance: 900, provenance: "observed" });
    expect(propertyEquity("2024-12-01", 5000, terms, schedule, [])).toBeNull();
    expect(propertyEquity("2026-01-01", 5000, terms, schedule, [])?.balance).toBe(0);
    expect(propertyEquity("2025-02-28", 5000, terms, schedule, [{ date: "2025-02-28", balance: -5, provenance: "observed" }])?.equity).toBe(5005);
    const asset = { balance: 5000, type: "asset" }, loan = { balance: 900, type: "liability" };
    const before = netWorthContribution(asset.balance, asset.type) + netWorthContribution(loan.balance, loan.type);
    propertyEquity("2025-02-28", asset.balance, terms, schedule, [{ date: "2025-02-28", balance: loan.balance, provenance: "manual" }]);
    expect(netWorthContribution(asset.balance, asset.type) + netWorthContribution(loan.balance, loan.type)).toBe(before);
  });
  it.each([{ annualRate: -1 }, { annualRate: 101 }, { principal: 0 }, { paymentAmount: 0 }, { termMonths: 0 }, { termMonths: 1201 }, { termMonths: 1.5 }, { startDate: "2025-02-30" }, { paymentAmount: 1 }])("rejects unusable terms %j", (change) => { expect(() => mortgageSchedule({ ...terms, ...change })).toThrow(); });
  it("keeps the most recent observation for current equity and labels its date", () => {
    const schedule = mortgageSchedule(terms);
    expect(currentPropertyEquity("2025-03-31", 5000, terms, schedule, [{ date: "2025-02-28", balance: 970, provenance: "observed" }, { date: "2026-01-01", balance: 0, provenance: "manual" }])).toEqual({ equity: 4030, balance: 970, provenance: "observed", asOf: "2025-02-28" });
    expect(currentPropertyEquity("2025-03-31", 5000, terms, schedule, [])?.provenance).toBe("estimated");
    expect(currentPropertyEquity("2024-01-01", 5000, terms, schedule, [])).toBeNull();
  });
});
describe("configuration boundary", () => {
  const base = { kind: "basis", id: "91000000-0000-4000-8000-000000000001", version: 0, data: { amount: 0, quantity: 2, source: "manual" } };
  it("accepts zero basis, resets, tax, and amortizing loan terms, stripping extra input", () => {
    expect(parsePortfolioInput({ ...base, user_id: "victim" })).toEqual(base);
    expect(parsePortfolioInput({ ...base, data: null })).toEqual({ ...base, data: null });
    expect(typeof parsePortfolioInput({ ...base, kind: "tax", data: { bucket: "unknown" } })).toBe("object");
    expect(typeof parsePortfolioInput({ ...base, kind: "mortgage", data: { liabilityId: base.id, liabilitySource: "manual", terms: { principal: 1200, annualRate: 0, paymentAmount: 100, startDate: "2026-01-01", termMonths: 12 } } })).toBe("object");
  });
  it("rejects malformed ids, stale versions, sources, precision, and terms", () => {
    for (const body of [null, [], { ...base, id: "bad" }, { ...base, version: -1 }, { ...base, version: 1.5 }, { ...base, data: [] }, { ...base, data: { ...base.data, amount: 0.001 } }, { ...base, data: { ...base.data, source: "reported" } }, { ...base, kind: "tax", data: { bucket: "__proto__" } }, { ...base, kind: "mortgage", data: {} }, { ...base, kind: "mortgage", data: { liabilityId: base.id, liabilitySource: "manual", terms: {} } }]) expect(typeof parsePortfolioInput(body)).toBe("string");
  });
});
describe("matched account performance population", () => {
  const snapshots: PerformanceSnapshot[] = ["2025-01-01", "2026-01-01"].map((date, i) => ({ account_id: "a", snapshot_date: date, current_balance: i ? 1100 : 1000, iso_currency_code: "USD", provenance: "observed" }));
  const flow: PerformanceTransaction = { account_id: "a", date: "2026-01-01", amount: -100, txn_type: "cash", txn_subtype: "deposit", iso_currency_code: "USD", is_active: true };
  it("uses the same account dates for TWR and XIRR and removes external contributions", () => {
    expect(recordedPerformance(["a"], snapshots, [])?.xirr?.rate).toBeCloseTo(0.1, 8);
    const result = recordedPerformance(["a"], snapshots, [flow]);
    expect(result?.xirr?.rate).toBeCloseTo(0, 8); expect(result?.twr.at(-1)?.pct).toBe(0);
    expect(recordedPerformance(["a", "missing"], snapshots, [])).toBeNull();
  });
  it("excludes estimates and refuses ambiguous transfers or currencies", () => {
    for (const change of [{ iso_currency_code: "CAD" }, { txn_type: "transfer", txn_subtype: "transfer" }, { amount: Number.NaN }]) expect(recordedPerformance(["a"], snapshots, [{ ...flow, ...change }])).toBeNull();
    expect(recordedPerformance(["a"], snapshots.map((s) => ({ ...s, provenance: "estimated" })), [])).toBeNull();
    expect(recordedPerformance(["a"], snapshots, [{ ...flow, amount: 2000 }])).toBeNull();
    expect(recordedPerformance(["a"], snapshots, [{ ...flow, account_id: "foreign-owner", amount: -9999 }, { ...flow, is_active: false }, { ...flow, date: "2025-01-01" }, { ...flow, txn_type: "buy", txn_subtype: "buy" }])?.xirr?.rate).toBeCloseTo(0.1, 8);
    expect(recordedPerformance(["a"], snapshots, [{ ...flow, txn_type: "buy", txn_subtype: "contribution", amount: 100 }])?.xirr?.rate).toBeCloseTo(0, 8);
    expect(recordedPerformance(["a"], snapshots, [{ ...flow, txn_subtype: "dividend" }])?.xirr?.rate).toBeCloseTo(0.1, 8);
    expect(recordedPerformance(["a"], snapshots, [{ ...flow, txn_subtype: "pending credit" }])).toBeNull();
  });
});
