import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Client-only buttons in the toolbar need the app router; this test is about
// the account chips' text, not those.
vi.mock("@/components/ConnectBankButton", () => ({
  default: () => createElement("button", null, "Connect bank"),
}));
vi.mock("@/components/RefreshButton", () => ({
  default: () => createElement("button", null, "Refresh"),
}));

const { default: DashboardToolbar } = await import(
  "@/components/dashboard/DashboardToolbar"
);
const { default: WealthView } = await import("@/components/dashboard/WealthView");
const { getDashboardData } = await import("@/lib/dashboard");
type AccountSummary = import("@/lib/dashboard").AccountSummary;

/**
 * Plaid account names often already end in the mask ("Chase Checking 1234"), so
 * a display site that concatenates name and mask prints it twice. Every
 * Dashboard label goes through `accountDisplayLabel`; matching still keys on
 * `account.id`, never on the rendered text.
 */
const ACCOUNT: AccountSummary = {
  id: "a1",
  user_id: "user-1",
  name: "Chase Total Checking 1234",
  official_name: null,
  mask: "1234",
  type: "depository",
  subtype: "checking",
  current_balance: 1000,
  available_balance: 1000,
  credit_limit: null,
  iso_currency_code: "USD",
  plaid_item_id: "item-1",
  apr: null,
} as AccountSummary;

function makeSupabase(): SupabaseClient {
  const build = (table: string) => {
    const rows = table === "accounts" ? [ACCOUNT] : [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lt", "in", "is", "order", "range", "limit"]) {
      chain[method] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

describe("dashboard account labels", () => {
  it("prints the mask once in the toolbar account filter", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardToolbar, {
        accounts: [ACCOUNT],
        months: ["2026-09"],
        selectedMonth: "2026-09",
        activeView: "monitor" as const,
        hasBanks: true,
        itemCount: 1,
        lastSyncAgoMinutes: 5,
      }),
    );

    expect(html).toContain("Chase Total Checking ••1234");
    expect(html).not.toContain("Chase Total Checking 1234 1234");
    // The link still carries the account id, not the display text.
    expect(html).toContain("accountId=a1");
  });

  it("prints the mask once in the Wealth depository list", async () => {
    const data = await getDashboardData(makeSupabase(), undefined, "2026-09", "user-1");
    const html = renderToStaticMarkup(
      createElement(WealthView, { data, linkParams: {}, selectedMonth: "2026-09" }),
    );

    expect(html).toContain("Chase Total Checking ••1234");
    expect(html).not.toContain("Chase Total Checking 1234 1234");
  });
});
