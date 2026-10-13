import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportsPage from "@/app/reports/page";
import { loadReportData, loadSavedReports, resolveReportScope } from "@/lib/reports-data";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner", email: "test@example.test" } } }) } }) }));
vi.mock("@/lib/report-period", () => ({ resolveViewerToday: async () => "2026-10-13" }));
vi.mock("@/lib/reports-data", () => ({ loadReportData: vi.fn(), loadSavedReports: vi.fn(), resolveReportScope: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), notFound: () => { throw new Error("not found"); } }));

const row: CanonicalFinanceTransaction = { id: "row", sourceTransactionId: "row", date: "2026-10-01", signedAmount: 100,
  flow: "expense", merchant: "Cafe", groupKey: "FOOD_AND_DRINK", categoryKey: "FOOD_AND_DRINK_RESTAURANTS",
  accountId: "account", manualAccountId: null, pending: false, source: "plaid" };

describe("Reports page integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveReportScope).mockResolvedValue({ scope: { kind: "mine", ownerUserId: "owner" }, visibleHouseholdIds: [] });
    vi.mocked(loadSavedReports).mockResolvedValue([]);
    vi.mocked(loadReportData).mockImplementation(async (_client, { filters }) => ({
      transactions: [{ ...row, date: filters.start }], facetTransactions: [row],
      currencyByAccountId: new Map([["account", "USD"]]), accountNames: new Map([["account", "Checking"]]), truncated: false,
    }));
  });

  it("loads comparison with identical scope, dimensions, and pending choices and renders both ranges", async () => {
    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ start: "2026-10-01", end: "2026-10-31",
      comparison: "previous_period", account: "account", merchant: "Cafe", pending: "exclude", currency: "USD", interval: "weekly" }) }));
    expect(loadReportData).toHaveBeenCalledTimes(2);
    const requests = vi.mocked(loadReportData).mock.calls.map(call => call[1]);
    expect(requests[1]).toEqual({ scope: { kind: "mine", ownerUserId: "owner" }, filters: {
      ...requests[0]!.filters, start: "2026-09-01", end: "2026-09-30",
    } });
    expect(html).toContain("Period comparison");
    expect(html).toContain("2026-09-01 to 2026-09-30");
    expect(html).toContain("Spending habits");
    expect(html).toContain("Print / Save PDF");
    expect(html).toContain("Checking");
  });

  it("avoids reference reads by default and preserves an empty chosen currency", async () => {
    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ currency: "EUR" }) }));
    expect(loadReportData).toHaveBeenCalledTimes(1);
    expect(html).toContain("No matching transactions in EUR");
    expect(html).not.toContain("Period comparison");
    expect(html).not.toContain("$100.00");
  });

  it("keeps incomplete-result warnings visible and withholds derived comparisons and habits", async () => {
    vi.mocked(loadReportData).mockResolvedValue({ transactions: [row], currencyByAccountId: new Map([["account", "USD"]]), truncated: true });
    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ comparison: "previous_year" }) }));
    expect(html).toContain("bounded row limit");
    expect(html).toContain("period is incomplete");
    expect(html).not.toContain("Spending habits");
    expect(html).not.toContain("report-comparison-heading");
  });
});
