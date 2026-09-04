import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OverviewView from "@/components/dashboard/OverviewView";
import { loadOverviewWidgetData } from "@/lib/dashboard-widgets-data";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock("@/lib/dashboard-widgets-data", () => ({
  loadOverviewWidgetData: vi.fn(async () => ({
    cumulativeSpend: { days: [], monthLabel: "August 2026", previousMonthLabel: "July 2026" },
    investments: null,
    ledgerStrip: {
      ticks: [{ id: "1", date: "2026-08-01", label: "Rent", amount: -1000, runningBalance: 2000, major: true }],
      account: { id: "acct-1", name: "Checking", mask: "0001", current_balance: 2000, iso_currency_code: "USD", type: "depository" },
      accounts: [
        { id: "acct-1", name: "Checking", mask: "0001", current_balance: 2000, iso_currency_code: "USD", type: "depository" },
        { id: "acct-2", name: "Savings", mask: "0002", current_balance: 5000, iso_currency_code: "USD", type: "depository" },
      ],
      currency: "USD",
    },
  })),
}));

vi.mock("@/components/dashboard/DashboardWidgetGrid", () => ({
  default: () => createElement("div", { "data-testid": "dashboard-widget-grid" }),
}));

vi.mock("@/components/dashboard/LedgerStrip", () => ({
  default: vi.fn((props: {
    accountId?: string;
    accounts?: unknown[];
    buildAccountHref?: (id: string | undefined) => string;
  }) =>
    createElement("div", {
      "data-testid": "ledger-strip",
      "data-account-id": props.accountId,
      "data-accounts-count": String(props.accounts?.length ?? 0),
      "data-account-href": props.buildAccountHref?.("acct-2"),
    }),
  ),
}));

const baseProps = {
  prefsRaw: {},
  data: {} as never,
  goals: [],
  recent: [],
  accountNames: new Map<string, string>(),
  accounts: [],
  userId: "user-1",
  household: false,
  month: "2026-08",
  selectedAccountId: "acct-global",
};

describe("OverviewView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes selectedLedgerAccountId as the widget-scoped id, not as the global filter", async () => {
    const element = await OverviewView({
      ...baseProps,
      selectedLedgerAccountId: "acct-ledger-specific",
      extraParams: { scope: "mine" },
    });
    renderToStaticMarkup(element);

    expect(loadOverviewWidgetData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        selectedAccountId: "acct-global",
        ledgerAccountId: "acct-ledger-specific",
      }),
    );
  });

  it("leaves ledgerAccountId unset when selectedLedgerAccountId is omitted", async () => {
    const element = await OverviewView({
      ...baseProps,
      selectedAccountId: "acct-global",
    });
    renderToStaticMarkup(element);

    expect(loadOverviewWidgetData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        selectedAccountId: "acct-global",
        ledgerAccountId: undefined,
      }),
    );
  });

  it("passes accounts, accountId, and buildAccountHref preserving extraParams to LedgerStrip", async () => {
    const element = await OverviewView({
      ...baseProps,
      selectedAccountId: "acct-global",
      selectedLedgerAccountId: "acct-1",
      extraParams: { scope: "household", itemId: "item-1" },
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-account-id="acct-1"');
    expect(html).toContain('data-accounts-count="2"');
    expect(html).toContain("view=overview");
    expect(html).toContain("accountId=acct-global");
    expect(html).toContain("ledgerAccount=acct-2");
    expect(html).toContain("scope=household");
    expect(html).toContain("itemId=item-1");
  });
});
