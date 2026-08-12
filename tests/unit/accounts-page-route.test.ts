import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

let featureEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => featureEnabled,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("@/components/shell/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    createElement("main", null, children),
}));
vi.mock("@/components/ConnectBankButton", () => ({
  default: () => createElement("button", null, "Add account"),
}));
vi.mock("@/components/RefreshButton", () => ({
  default: () => createElement("button", null, "Refresh all"),
}));

let supabase = makeClient();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabase),
}));

function makeClient(
  seeds: Parameters<typeof clientStub>[0] = {
    households: { data: [] },
    accounts: { data: [] },
    manual_accounts: { data: [] },
    account_balance_snapshots: { data: [] },
    plaid_items: { data: [] },
    profiles: { data: { dashboard_prefs: {} } },
  },
) {
  return {
    ...clientStub(seeds),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "user@example.com" } },
      }),
    },
  };
}

import AccountsPage from "@/app/accounts/page";

beforeEach(() => {
  featureEnabled = true;
  supabase = makeClient();
});

describe("/accounts page", () => {
  it("returns not found while the rollout flag is disabled", async () => {
    featureEnabled = false;

    await expect(
      AccountsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders an honest empty state and scopes personal reads", async () => {
    const element = await AccountsPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Accounts");
    expect(html).toContain("No accounts yet");
    expect(html).toContain("Add account");
    expect(supabase.scopedToUser("accounts", "user-1")).toBe(true);
    expect(
      supabase.scopedToUser("account_balance_snapshots", "user-1"),
    ).toBe(true);
  });

  it("uses RLS-visible rows without a user filter for household scope", async () => {
    supabase = makeClient({
      households: { data: [{ id: "household-1" }] },
      accounts: { data: [] },
      manual_accounts: { data: [] },
      account_balance_snapshots: { data: [] },
      plaid_items: { data: [] },
      profiles: { data: { dashboard_prefs: {} } },
    });

    await AccountsPage({
      searchParams: Promise.resolve({ scope: "household-1" }),
    });

    expect(supabase.scopedToUser("accounts", "user-1")).toBe(false);
    expect(
      supabase.scopedToUser("account_balance_snapshots", "user-1"),
    ).toBe(false);
  });

  it("resolves institution metadata via the household-safe RPC, not owner-scoped plaid_items", async () => {
    supabase = makeClient({
      households: { data: [{ id: "household-1" }] },
      accounts: { data: [] },
      manual_accounts: { data: [] },
      account_balance_snapshots: { data: [] },
      plaid_items: { data: [] },
      visible_institutions: {
        data: [
          {
            id: "item-1",
            institution_name: "First Bank",
            institution_logo: null,
            institution_brand_color: null,
          },
        ],
      },
      profiles: { data: { dashboard_prefs: {} } },
    });

    await AccountsPage({
      searchParams: Promise.resolve({ scope: "household-1" }),
    });

    expect(supabase.rpc).toHaveBeenCalledWith("visible_institutions");
    // The page must not read plaid_items owner-scoped for shared accounts.
    expect(supabase.callsOn("plaid_items")).toEqual([]);
  });
});
