import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCanonicalProjection } from "@/lib/finance-query";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import {
  loadReportData,
  loadSavedReports,
  resolveReportScope,
} from "@/lib/reports-data";
import { defaultReportFilters, type ReportFilters } from "@/lib/reports";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/finance-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/finance-query")>(),
  loadCanonicalProjection: vi.fn(),
}));

function txn(
  partial: Partial<CanonicalFinanceTransaction>,
): CanonicalFinanceTransaction {
  return {
    id: "t1",
    sourceTransactionId: "s1",
    date: "2026-07-10",
    signedAmount: 100,
    flow: "expense",
    merchant: "Costco",
    groupKey: "FOOD_AND_DRINK",
    categoryKey: "FOOD_AND_DRINK_GROCERIES",
    accountId: "acct-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...partial,
  };
}

const filters: ReportFilters = defaultReportFilters("2026-07");
const manualId = "00000000-0000-4000-8000-000000000001";

describe("loadReportData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCanonicalProjection).mockResolvedValue({
      transactions: [
        txn({ id: "in-range", date: "2026-07-10" }),
        // The coarse window is month-bounded, but a filter can be narrower, so
        // applyReportFilters still has to run over what came back.
        txn({ id: "out-of-range", date: "2026-07-31" }),
      ],
      currencyByAccountId: new Map([["acct-1", "USD"]]),
      truncated: false,
    });
  });

  it("queries with an exclusive end so the last day is included", async () => {
    await loadReportData(clientStub() as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
      filters,
    });

    expect(loadCanonicalProjection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        window: { start: "2026-07-01", endExclusive: "2026-08-01" },
      }),
    );
  });

  it("passes the pending choice down to the bounded read", async () => {
    await loadReportData(clientStub() as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
      filters: { ...filters, excludePending: true },
    });
    expect(loadCanonicalProjection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludePending: true }),
    );
  });

  it("applies the exact filters on top of the coarse window", async () => {
    const result = await loadReportData(clientStub() as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
      filters: { ...filters, end: "2026-07-15" },
    });
    expect(result.transactions.map((row) => row.id)).toEqual(["in-range"]);
  });

  it("retains bounded facets before account, category, and merchant selection", async () => {
    vi.mocked(loadCanonicalProjection).mockResolvedValue({
      transactions: [txn({ id: "chosen", merchant: "Shop" }), txn({ id: "other", merchant: "Cafe" })],
      currencyByAccountId: new Map([["acct-1", "USD"]]),
      accountNames: new Map([["acct-1", "Checking"]]),
      truncated: false,
    });
    const result = await loadReportData(clientStub() as never, {
      scope: { kind: "mine", ownerUserId: "user-1" }, filters: { ...filters, merchants: ["Shop"] },
    });
    expect(result.transactions.map(row => row.id)).toEqual(["chosen"]);
    expect(result.facetTransactions?.map(row => row.id)).toEqual(["chosen", "other"]);
    expect(result.accountNames?.get("acct-1")).toBe("Checking");
  });

  it("passes truncation through so the page can say so", async () => {
    vi.mocked(loadCanonicalProjection).mockResolvedValue({
      transactions: [],
      currencyByAccountId: new Map(),
      truncated: true,
    });
    const result = await loadReportData(clientStub() as never, {
      scope: { kind: "mine", ownerUserId: "user-1" },
      filters,
    });
    expect(result.truncated).toBe(true);
  });

  it("labels manual accounts without changing their currency classification", async () => {
    const currencies = new Map([["acct-1", "USD"]]);
    vi.mocked(loadCanonicalProjection).mockResolvedValue({
      transactions: [txn({ accountId: null, manualAccountId: "cash", source: "manual" })],
      currencyByAccountId: currencies,
      accountNames: new Map([["acct-1", "Checking"]]),
      truncated: false,
    });
    const client = clientStub({ manual_accounts: { data: [{ id: "cash", name: "Cash wallet" }], count: 1 } });
    const result = await loadReportData(client as never, { scope: { kind: "mine", ownerUserId: "user-1" }, filters });
    expect(result.accountNames).toEqual(new Map([["acct-1", "Checking"], ["cash", "Cash wallet"]]));
    expect(result.currencyByAccountId).toBe(currencies);
    expect(client.scopedToUser("manual_accounts", "user-1")).toBe(true);
  });

  it("bounds selected-account label reads and lets household RLS control visibility", async () => {
    const accounts = Array.from({ length: 301 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const client = clientStub({ manual_accounts: { data: [], count: 0 } });
    await loadReportData(client as never, {
      scope: { kind: "household", householdId: "hh-1" }, filters: { ...filters, accounts },
    });
    const batches = client.callsOn("manual_accounts").filter(call => call.method === "in");
    expect(batches.map(call => (call.args[1] as string[]).length)).toEqual([150, 150, 1]);
    expect(client.callsOn("manual_accounts").some(call => call.method === "eq")).toBe(false);
  });

  it("stops before later account batches when a label read fails", async () => {
    const accounts = Array.from({ length: 301 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const client = clientStub({ manual_accounts: { error: { code: "42501" } } });
    await expect(loadReportData(client as never, {
      scope: { kind: "mine", ownerUserId: "user-1" }, filters: { ...filters, accounts },
    })).rejects.toBeDefined();
    expect(client.callsOn("manual_accounts").filter(call => call.method === "in")).toHaveLength(1);
  });

  it.each([
    { error: { code: "42501" } },
    { data: null, count: 1 },
    { data: [] },
    { data: [], count: 1 },
  ])("rejects failed or incomplete account-label reads: %j", async (response) => {
    const client = clientStub({ manual_accounts: response });
    await expect(loadReportData(client as never, {
      scope: { kind: "mine", ownerUserId: "user-1" }, filters: { ...filters, accounts: [manualId] },
    })).rejects.toBeDefined();
  });

  it("keeps malformed account selections empty without sending them to a UUID column", async () => {
    const client = clientStub({ manual_accounts: { error: { code: "22P02" } } });
    const result = await loadReportData(client as never, {
      scope: { kind: "mine", ownerUserId: "user-1" }, filters: { ...filters, accounts: ["invalid"] },
    });
    expect(result.transactions).toEqual([]);
    expect(client.callsOn("manual_accounts")).toEqual([]);
  });

  it("forwards a household scope untouched", async () => {
    await loadReportData(clientStub() as never, {
      scope: { kind: "household", householdId: "hh-1" },
      filters,
    });
    expect(loadCanonicalProjection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: { kind: "household", householdId: "hh-1" },
      }),
    );
  });
});

describe("resolveReportScope", () => {
  it("honours a household id that RLS actually returned", async () => {
    const client = clientStub({ households: { data: [{ id: "hh-1" }] } });
    const result = await resolveReportScope(client as never, "user-1", "hh-1");
    expect(result.scope).toEqual({ kind: "household", householdId: "hh-1" });
    expect(result.visibleHouseholdIds).toEqual(["hh-1"]);
  });

  it("degrades a guessed household id to the caller's own rows", async () => {
    const client = clientStub({ households: { data: [{ id: "hh-1" }] } });
    const result = await resolveReportScope(client as never, "user-1", "hh-999");
    expect(result.scope).toEqual({ kind: "mine", ownerUserId: "user-1" });
  });

  it("defaults to mine when there is no household at all", async () => {
    const client = clientStub({ households: { data: [] } });
    const result = await resolveReportScope(client as never, "user-1", undefined);
    expect(result.scope).toEqual({ kind: "mine", ownerUserId: "user-1" });
    expect(result.visibleHouseholdIds).toEqual([]);
  });

  it("throws rather than silently falling back when the query fails", async () => {
    const client = clientStub({ households: { error: { code: "42501" } } });
    await expect(
      resolveReportScope(client as never, "user-1", undefined),
    ).rejects.toBeDefined();
  });
});

describe("loadSavedReports", () => {
  it("scopes the read to the caller and orders by most recent edit", async () => {
    const client = clientStub({
      saved_reports: { data: [{ id: "r1", name: "July", report_type: "cash_flow", filters }] },
    });
    const rows = await loadSavedReports(client as never, "user-1");

    expect(rows).toHaveLength(1);
    expect(client.scopedToUser("saved_reports", "user-1")).toBe(true);
    const calls = client.callsOn("saved_reports");
    expect(calls.some(({ method, args }) => method === "order" && args[0] === "updated_at")).toBe(true);
    expect(calls.some(({ method }) => method === "limit")).toBe(true);
  });

  it("returns an empty list when there is nothing saved", async () => {
    const client = clientStub({ saved_reports: { data: null } });
    await expect(loadSavedReports(client as never, "user-1")).resolves.toEqual([]);
  });

  it("throws when the table read fails, rather than hiding it as empty", async () => {
    const client = clientStub({ saved_reports: { error: { code: "42P01" } } });
    await expect(loadSavedReports(client as never, "user-1")).rejects.toBeDefined();
  });
});
