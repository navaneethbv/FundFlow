import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => false,
}));

let supabase = makeClient();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabase),
}));

function makeClient() {
  return {
    ...clientStub({
      saved_views: { data: [] },
      accounts: { data: [] },
      manual_accounts: { data: [] },
      // No remap rules: the ledger stays on the direct database path, which is
      // the only path where the requested sort reaches Postgres.
      merchant_rules: { data: [] },
      goals: { data: [] },
      transactions: { data: [], count: 0 },
      transaction_splits: { data: [] },
      user_tags: { data: [] },
      profiles: { data: { ledger_prefs: {} } },
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "user@example.com" } },
      }),
    },
  };
}

import TransactionsPage from "@/app/transactions/page";

/**
 * The ordering of the paged query only: the counted `select` starts it, and the
 * next `select` is the unordered facet scan that follows on the same stub.
 */
function orderColumns() {
  const calls = supabase.callsOn("transactions");
  const start = calls.findIndex(
    ({ method, args }) =>
      method === "select" && (args[1] as { count?: string })?.count === "exact",
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const next = calls.findIndex(
    ({ method }, index) => index > start && method === "select",
  );
  return calls
    .slice(start + 1, next < 0 ? calls.length : next)
    .filter(({ method }) => method === "order")
    .map(({ args }) => [args[0], (args[1] as { ascending?: boolean })?.ascending]);
}

beforeEach(() => {
  supabase = makeClient();
});

/**
 * postgrest-js appends every `order()` call, so a default ordering applied
 * before the requested one silently wins and the ledger ignores `?sort=`.
 */
describe("/transactions row ordering", () => {
  it("sorts by amount when asked, with no date ordering ahead of it", async () => {
    await TransactionsPage({
      searchParams: Promise.resolve({ sort: "amount", direction: "desc" }),
    });

    expect(orderColumns()).toEqual([
      ["amount", true],
      ["date", false],
      ["id", true],
    ]);
  });

  it("honours an ascending date sort instead of the descending default", async () => {
    await TransactionsPage({
      searchParams: Promise.resolve({ sort: "date", direction: "asc" }),
    });

    expect(orderColumns()).toEqual([
      ["date", true],
      ["id", true],
    ]);
  });

  it("keeps the default newest-first order when no sort is requested", async () => {
    await TransactionsPage({ searchParams: Promise.resolve({}) });

    expect(orderColumns()).toEqual([
      ["date", false],
      ["id", true],
    ]);
  });
});
