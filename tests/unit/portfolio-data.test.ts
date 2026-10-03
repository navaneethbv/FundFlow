import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clientStub } from "../fixtures/supabase-query";
import { loadMortgageData, portfolioRows } from "@/lib/portfolio-data";
import { BasisAnalysis, TaxAnalysis, RecordedPerformance } from "@/components/investments/InvestmentAnalysis";
import PropertyEquityPanel from "@/components/accounts/PropertyEquityPanel";
import { loadForecastPageData } from "@/lib/forecasting-data";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllEnvs());
const owner = "owner";
const account = { id: "a", name: "Brokerage", source: "plaid" as const, type: "investment", subtype: "brokerage", balance: 1100, currency: "USD" };
const terms = { principal: 1200, annualRate: 0, paymentAmount: 100, startDate: "2025-01-01", termMonths: 12 };

it("paginates owner-scoped data with deterministic ordering, and refuses truncation/errors", async () => {
  const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
  const client = clientStub({ holdings: { data: rows } });
  expect(await portfolioRows(client as never, owner, "holdings", "id", "id")).toEqual(rows);
  expect(client.scopedToUser("holdings", owner)).toBe(true);
  expect(client.callsOn("holdings").filter((call) => call.method === "range")).toHaveLength(3);
  await expect(portfolioRows(clientStub({ holdings: { error: new Error("read failure") } }) as never, owner, "holdings", "id", "id")).rejects.toThrow("read failure");
  await expect(portfolioRows(clientStub({ holdings: { data: Array(10001).fill({}) } }) as never, owner, "holdings", "id", "id")).rejects.toThrow("read limit");
  expect(await portfolioRows(clientStub() as never, owner, "holdings", "id", "id")).toEqual([]);
});
it("loads only eligible liabilities and owner-filtered historical observations", async () => {
  const client = clientStub({ property_mortgages: { data: [{ manual_account_id: "p", liability_account_id: "loan", liability_manual_account_id: null, terms, version: 1 }] },
    accounts: { data: [{ id: "loan", type: "loan", iso_currency_code: "USD", name: "Mortgage" }, { id: "foreign", type: "loan", iso_currency_code: "CAD" }, { id: "cash", type: "depository", iso_currency_code: "USD" }] },
    manual_accounts: { data: [{ id: "manual-loan", name: "Loan", account_type: "liability" }, { id: "p", account_type: "asset" }] },
    account_balance_snapshots: { data: [{ snapshot_date: "2025-01-01", current_balance: 1000, provenance: null }, { snapshot_date: "2025-02-01", current_balance: null, provenance: "manual" }] },
  });
  const result = await loadMortgageData(client as never, owner, "p");
  expect(result.options.map((a) => a.id)).toEqual(["loan", "manual-loan"]);
  expect(result.observations).toEqual([{ date: "2025-01-01", balance: 1000, provenance: "observed" }]);
  expect(client.callsOn("account_balance_snapshots")).toContainEqual({ method: "eq", args: ["account_id", "loan"] });
  for (const table of ["property_mortgages", "accounts", "manual_accounts", "account_balance_snapshots"]) expect(client.scopedToUser(table, owner)).toBe(true);
  expect((await loadMortgageData(clientStub() as never, owner, "p")).link).toBeNull();
  const manual = clientStub({ property_mortgages: { data: [{ manual_account_id: "p", liability_manual_account_id: "m", terms, version: 3 }] }, account_balance_snapshots: { data: [{ snapshot_date: "2025-01-01", current_balance: 50 }] } });
  expect((await loadMortgageData(manual as never, owner, "p")).observations[0].provenance).toBe("manual");
  const live = clientStub({ property_mortgages: { data: [{ manual_account_id: "p", liability_account_id: "a", terms, version: 3 }] }, accounts: { data: [{ id: "a", type: "loan", iso_currency_code: "USD", name: "Loan", current_balance: -5, updated_at: "2026-01-01T12:00:00Z" }] } });
  expect((await loadMortgageData(live as never, owner, "p")).currentObservation).toEqual({ date: "2026-01-01", balance: -5, provenance: "observed" });
});
it("does not query new tables while the analysis flags are disabled", async () => {
  const client = clientStub(); const props = { client: client as never, userId: owner, accounts: [account] };
  expect(await BasisAnalysis(props)).toBeNull(); expect(await TaxAnalysis(props)).toBeNull(); expect(await RecordedPerformance(props)).toBeNull();
  expect(await PropertyEquityPanel({ client: client as never, userId: owner, propertyId: "p", today: "2026-01-01", history: [] })).toBeNull();
  expect(client.from).not.toHaveBeenCalled();
});
it("renders partial coverage, explicit sources and unknown tax allocations", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "investmentBasis,investmentTaxBuckets");
  const client = clientStub({ holdings: { data: [
    { id: "h1", account_id: "a", quantity: 2, institution_value: 100, cost_basis: 50, is_active: true, securities: { name: "Known", iso_currency_code: "USD" } },
    { id: "h2", account_id: "a", quantity: 1, institution_value: 300, cost_basis: null, is_active: true, securities: { name: "Unknown", iso_currency_code: "USD" } },
    { id: "h3", account_id: "other", is_active: true },
  ] }, holding_basis_annotations: { data: [{ holding_id: "h1", amount: 40, quantity: 2, source: "manual", version: 2 }] }, account_tax_treatments: { data: [{ account_id: "a", manual_account_id: null, bucket: "roth", version: 3 }] } });
  const props = { client: client as never, userId: owner, accounts: [account] };
  const basis = renderToStaticMarkup(await BasisAnalysis(props));
  expect(basis).toContain("25.0% basis coverage"); expect(basis).toContain("Partial gain"); expect(basis).toContain("$60.00"); expect(basis).toContain("missing or stale");
  const tax = renderToStaticMarkup(await TaxAnalysis(props)); expect(tax).toContain("Roth"); expect(tax).toContain("User override");
  expect(client.scopedToUser("holding_basis_annotations", owner)).toBe(true);
});
it("renders matched returns and an unavailable state without inventing performance", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "investmentXirr,historyProvenance");
  const snapshots = ["2025-01-01", "2026-01-01"].map((date, i) => ({ id: String(i), account_id: "a", snapshot_date: date, current_balance: i ? 1100 : 1000, iso_currency_code: "USD", provenance: "observed" }));
  const client = clientStub({ account_balance_snapshots: { data: snapshots } });
  const html = renderToStaticMarkup(await RecordedPerformance({ client: client as never, userId: owner, accounts: [account] }));
  expect(html).toContain("10.00%"); expect(html).toContain("Newton starts at 10%");
  const props = { client: clientStub() as never, userId: owner, accounts: [account] };
  expect(renderToStaticMarkup(await RecordedPerformance(props))).toContain("Return unavailable");
  expect(renderToStaticMarkup(await RecordedPerformance({ ...props, accounts: [] }))).toContain("Return unavailable");
});
it("renders mortgage equity without altering loaded account balances", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "mortgageEquity,amortizationEngine");
  const client = clientStub({ property_mortgages: { data: [{ manual_account_id: "p", liability_manual_account_id: "m", terms, version: 3 }] }, manual_accounts: { data: [{ id: "m", name: "Mortgage", account_type: "liability" }] } });
  const html = renderToStaticMarkup(await PropertyEquityPanel({ client: client as never, userId: owner, propertyId: "p", today: "2026-01-01", history: [{ valuation_date: "2025-01-01", owned_value: 5000, provenance: "manual" }] }));
  expect(html).toContain("$3,900.00"); expect(html).toContain("Presentation only"); expect(html).toContain("estimated");
  expect(client.rpc).not.toHaveBeenCalled();
});
it("feeds Forecasting only included investment balances using the same tax overrides", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "investmentTaxBuckets");
  const client = clientStub({ accounts: { data: [
    { id: "a", type: "investment", subtype: "ira", current_balance: 1000, iso_currency_code: "USD" },
    { id: "excluded", type: "investment", current_balance: 9000, iso_currency_code: "USD" },
    { id: "cash", type: "depository", subtype: "checking", current_balance: 800, iso_currency_code: "USD" },
  ] }, manual_accounts: { data: [{ id: "m", account_type: "investment", balance: 500 }, { id: "off", account_type: "investment", balance: 900, include_in_net_worth: false }] },
  profiles: { data: { dashboard_prefs: { accountsPage: { excludedNetWorthIds: ["excluded"] } } } },
  account_tax_treatments: { data: [{ account_id: "a", manual_account_id: null, bucket: "roth", version: 1 }] } });
  const result = await loadForecastPageData(client as never, owner, "2026-01-01");
  expect(result.taxSummary?.buckets.roth).toBe(1000); expect(result.taxSummary?.buckets.unknown).toBe(500);
  expect(Object.values(result.taxSummary!.buckets).reduce((a, b) => a + b, 0)).toBe(result.startingState.investments);
});
