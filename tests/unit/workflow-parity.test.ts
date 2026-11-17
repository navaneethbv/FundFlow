import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { netWorthWindow } from "@/components/dashboard/widgets/NetWorthWidget";
import LedgerSummary from "@/components/transactions/LedgerSummary";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import type { LedgerProjectedRow } from "@/lib/ledger-projection";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/components/ConnectBankButton", () => ({ default: () => null }));
vi.mock("@/components/RefreshButton", () => ({ default: () => null }));

describe("workflow parity boundaries", () => {
  it("labels the summary's page scope and keeps unknown currencies explicit", () => {
    const rows = [
      { date: "2026-10-02", pending: true, iso_currency_code: "EUR", amount: 10 },
      { date: "2026-10-01", pending: false, iso_currency_code: null, amount: -20 },
    ] as LedgerProjectedRow[];
    const html = renderToStaticMarkup(createElement(LedgerSummary, { rows, total: 300, page: 2 }));
    expect(html).toContain("Page 2 of the current search");
    expect(html).toContain("300");
    expect(html).toContain("EUR, Unknown");
    expect(html).toContain("Oct 1, 2026");
    expect(html).toContain("Oct 2, 2026");
    expect(html).not.toContain("$10");
    expect(html).not.toContain("Total spending");
  });
  it("renders empty summary dates without inventing financial values", () => {
    const html = renderToStaticMarkup(createElement(LedgerSummary, { rows: [], total: 0, page: 1 }));
    expect(html).toContain("—");
    expect(html).not.toContain("$0");
  });
  it("preserves household, institution and drill filters in both selectors", () => {
    const html = renderToStaticMarkup(createElement(DashboardToolbar, {
      accounts: [], months: ["2026-10"], selectedMonth: "2026-11", activeView: "overview",
      hasBanks: true, itemCount: 1, lastSyncAgoMinutes: 2,
      extraParams: { scope: "household", itemId: "institution", category: "FOOD" },
    }));
    const options = [...html.matchAll(/<option[^>]*value="([^"]*)"/g)].map(match => match[1]);
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option).toContain("scope=household");
      expect(option).toContain("itemId=institution");
      expect(option).toContain("category=FOOD");
    }
    expect(html).toContain('selected=""');
    expect(html).toContain("Nov 2026");
  });
});

 it("does not stretch a month selection across missing snapshots", () => {
   const history = [{ month: "2026-01", netWorth: 100 }, { month: "2026-10", netWorth: 200 }, { month: "2026-11", netWorth: 300 }];
   expect(netWorthWindow(history, "3")).toEqual(history.slice(1));
   expect(netWorthWindow(history, "all")).toEqual(history);
   expect(netWorthWindow([], "1")).toEqual([]);
 });
