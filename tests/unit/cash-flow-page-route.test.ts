import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import type { CashFlowLoadResult } from "@/lib/cash-flow-data";
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

const loadSpy = vi.fn();
vi.mock("@/lib/cash-flow-data", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/cash-flow-data")>();
  return {
    ...original,
    loadCashFlowData: (...args: unknown[]) => loadSpy(...args),
  };
});

let authenticated = true;
let supabase = makeClient();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabase),
}));

function makeClient(householdIds: string[] = []) {
  return {
    ...clientStub({
      households: {
        data: householdIds.map((id) => ({ id })),
      },
    }),
    auth: {
      getUser: vi.fn().mockImplementation(() =>
        Promise.resolve({
          data: {
            user: authenticated
              ? { id: "user-1", email: "user@example.com" }
              : null,
          },
        }),
      ),
    },
  };
}

function transaction(
  input: Partial<CanonicalFinanceTransaction> &
    Pick<
      CanonicalFinanceTransaction,
      "id" | "date" | "signedAmount" | "flow" | "accountId"
    >,
): CanonicalFinanceTransaction {
  return {
    sourceTransactionId: input.id,
    merchant: "Merchant",
    groupKey: "FOOD_AND_DRINK",
    categoryKey: "GROCERIES",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...input,
  };
}

const EMPTY_RESULT: CashFlowLoadResult = {
  transactions: [],
  currencyByAccountId: new Map(),
  truncated: false,
  lastSuccessfulSyncAt: "2026-07-29T10:00:00.000Z",
  stale: false,
};

import CashFlowPage from "@/app/cash-flow/page";

beforeEach(() => {
  featureEnabled = true;
  authenticated = true;
  supabase = makeClient();
  loadSpy.mockReset();
  loadSpy.mockResolvedValue(EMPTY_RESULT);
});

describe("/cash-flow page", () => {
  it("returns not found while the rollout flag is disabled", async () => {
    featureEnabled = false;

    await expect(
      CashFlowPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("returns not found without an authenticated user", async () => {
    authenticated = false;
    supabase = makeClient();

    await expect(
      CashFlowPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders an honest empty state and loads Mine scope by default", async () => {
    const element = await CashFlowPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Cash Flow");
    expect(html).toContain("No cash flow yet");
    expect(html).toContain('href="/transactions"');
    expect(loadSpy).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        scope: { kind: "mine", ownerUserId: "user-1" },
        rangeMonths: 12,
      }),
    );
  });

  it("uses a visible Household id and rejects a guessed one", async () => {
    supabase = makeClient(["household-1"]);

    await CashFlowPage({
      searchParams: Promise.resolve({ scope: "household-1" }),
    });
    expect(loadSpy).toHaveBeenLastCalledWith(
      supabase,
      expect.objectContaining({
        scope: { kind: "household", householdId: "household-1" },
      }),
    );

    await CashFlowPage({
      searchParams: Promise.resolve({ scope: "guessed-household" }),
    });
    expect(loadSpy).toHaveBeenLastCalledWith(
      supabase,
      expect.objectContaining({
        scope: { kind: "mine", ownerUserId: "user-1" },
      }),
    );
  });

  it("renders partial, stale, and separated-currency disclosures", async () => {
    loadSpy.mockResolvedValue({
      transactions: [
        transaction({
          id: "cad-income",
          date: "2026-07-01",
          signedAmount: -1000,
          flow: "income",
          accountId: "account-cad",
        }),
        transaction({
          id: "usd-expense",
          date: "2026-07-02",
          signedAmount: 200,
          flow: "expense",
          accountId: "account-usd",
        }),
      ],
      currencyByAccountId: new Map([
        ["account-cad", "CAD"],
        ["account-usd", "USD"],
      ]),
      truncated: true,
      lastSuccessfulSyncAt: "2026-07-20T10:00:00.000Z",
      stale: true,
    } satisfies CashFlowLoadResult);

    const element = await CashFlowPage({
      searchParams: Promise.resolve({
        period: "monthly",
        range: "24",
        selected: "2026-07",
        dimension: "merchant",
        currency: "not-a-currency",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Some transactions are not shown");
    expect(html).toContain("Cash Flow data may be stale");
    expect(html).toContain(
      "Totals are separated by currency because FundFlow does not guess exchange rates.",
    );
    expect(html).toContain("CA$1,000.00");
    expect(html).toContain(">CAD<");
    expect(html).toContain(">USD<");
  });
});
