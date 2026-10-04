import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAccountLookups,
  loadLedgerRowDetails,
  loadLedgerRows,
  type LedgerChunkFilters,
} from "@/app/transactions/_lib/ledger-page-data";
import { parseLedgerQuery } from "@/lib/ledger-query";

type Result = { data?: unknown[] | null; error?: { code?: string; message?: string } | null; count?: number | null };
type Call = { method: string; args: unknown[] };

/**
 * A chainable stand-in for the postgrest builder. Every filter call is recorded
 * per query so tests can assert owner scoping and the exact filters applied.
 */
function fakeSupabase(resultFor: (table: string, select: string, calls: Call[]) => Result) {
  const queries: Array<{ table: string; select: string; calls: Call[] }> = [];
  const client = {
    from(table: string) {
      const query = { table, select: "", calls: [] as Call[] };
      queries.push(query);
      const resolve = () => {
        const result = resultFor(table, query.select, query.calls);
        return { data: result.data === undefined ? [] : result.data, error: result.error ?? null, count: result.count ?? null };
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["eq", "in", "or", "gte", "lte", "lt", "gt", "order", "range"]) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.select = (columns: string, options?: unknown) => {
        query.select = columns;
        query.calls.push({ method: "select", args: [columns, options] });
        return builder;
      };
      builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected);
      return builder;
    },
  };
  return { client: client as never, queries };
}

const has = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some((call) => call.method === method && JSON.stringify(call.args.slice(0, args.length)) === JSON.stringify(args));

function row(id: string, date: string, extra: Record<string, unknown> = {}) {
  return {
    id, date, amount: 10, iso_currency_code: "USD", pending: false,
    merchant_name: `Shop ${id}`, name: `Shop ${id}`, pfc_primary: "FOOD_AND_DRINK", pfc_detailed: "FOOD_AND_DRINK_COFFEE",
    account_id: "acct-1", manual_account_id: null, ...extra,
  };
}

const baseFilters: LedgerChunkFilters = {
  bounds: null, ownerId: "user-1", accountId: "", q: "", flow: "", accountType: "",
  transactionsParityEnabled: false, transactionReviewEnabled: false, reviewFilter: "all",
  typedIds: [], missingAccountId: "missing",
};

function input(overrides: { filters?: Partial<LedgerChunkFilters>; params?: Record<string, string>; supabase: never; mappings?: Map<string, string> }) {
  return {
    supabase: overrides.supabase,
    state: parseLedgerQuery(overrides.params ?? {}),
    filters: { ...baseFilters, ...overrides.filters },
    columns: "id,date,amount",
    rules: [],
    accountNamesById: new Map([["acct-1", "Checking"]]),
    accountLabelsById: new Map([["acct-1", "Checking ••1234"]]),
    accountOptionsForFilters: [{ value: "acct-1", label: "Checking" }],
    categoryMappings: overrides.mappings ?? new Map<string, string>(),
    ledgerError: "",
  };
}

afterEach(() => vi.restoreAllMocks());

describe("buildAccountLookups", () => {
  it("keys both account kinds and falls back for missing names", () => {
    const lookups = buildAccountLookups(
      [{ id: "a1", name: "Checking", mask: "1234" }, { id: "a2", name: null }],
      [{ id: "m1", name: "Cash" }, { id: "m2", name: 7 }],
    );
    expect(lookups.accountNamesById.get("a1")).toBe("Checking");
    expect(lookups.accountNamesById.get("a2")).toBe("");
    expect(lookups.accountLabelsById.get("a1")).toContain("1234");
    expect(lookups.accountLabelsById.get("m1")).toBe("Cash (manual)");
    expect(lookups.accountLabelsById.get("m2")).toBe("Account (manual)");
    expect(lookups.accountOptions.map((option) => option.source)).toEqual(["plaid", "plaid", "manual", "manual"]);
  });
});

describe("loadLedgerRowDetails", () => {
  it("skips every query for an empty page", async () => {
    const { client, queries } = fakeSupabase(() => ({}));
    const result = await loadLedgerRowDetails(client, "user-1", []);
    expect(queries).toHaveLength(0);
    expect(result.failed).toBe(false);
  });

  it("scopes all three reads to the owner and shapes their rows", async () => {
    const { client, queries } = fakeSupabase((table) => {
      if (table === "transaction_annotations") return { data: [
        { transaction_id: "t1", note: "Lunch", tags: ["work"], display_category: "Meals", cash_flow_classification: "expense", cleared_at: "2026-01-02" },
        { transaction_id: "t2", note: null, tags: null, display_category: null, cash_flow_classification: "bogus", cleared_at: null },
      ] };
      if (table === "transaction_splits") return { data: [
        { transaction_id: "t1", category: "Meals", amount: "6" },
        { transaction_id: "t1", category: "Travel", amount: 4 },
      ] };
      return { data: [{ excluded_transaction_id: "t2" }] };
    });
    const result = await loadLedgerRowDetails(client, "user-1", ["t1", "t2"]);
    expect(queries.every((query) => has(query.calls, "eq", "user_id", "user-1"))).toBe(true);
    expect(result.annById.get("t1")).toEqual({ note: "Lunch", tags: ["work"], cleared: true });
    expect(result.annById.get("t2")).toEqual({ note: null, tags: [], cleared: false });
    expect(result.overridesById.get("t1")).toEqual({ displayCategory: "Meals", cashFlowClassification: "expense" });
    expect(result.overridesById.get("t2")?.cashFlowClassification).toBeNull();
    expect(result.splitsById.get("t1")).toEqual([{ category: "Meals", amount: 6 }, { category: "Travel", amount: 4 }]);
    expect([...result.excludedDuplicateIds]).toEqual(["t2"]);
    expect(result.failed).toBe(false);
  });

  it("treats null detail results as empty", async () => {
    const { client } = fakeSupabase(() => ({ data: null }));
    const result = await loadLedgerRowDetails(client, "user-1", ["t1"]);
    expect(result.annById.size + result.splitsById.size + result.excludedDuplicateIds.size).toBe(0);
    expect(result.failed).toBe(false);
  });

  it("reports a failed detail read without discarding the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeSupabase((table) => table === "transaction_splits"
      ? { error: { code: "42501" } }
      : { data: [] });
    const result = await loadLedgerRowDetails(client, "user-1", ["t1"]);
    expect(result.failed).toBe(true);
    expect(result.splitsById.size).toBe(0);
  });
});

describe("loadLedgerRows", () => {
  it.each(["", "merchant"])("applies absolute amount bounds and status before pagination and facets (%s)", async (sort) => {
    const { client, queries } = fakeSupabase(() => ({ data: [] }));
    await loadLedgerRows(input({ supabase: client, params: { sort }, filters: { minAmount: "10", maxAmount: "50", status: "posted" } }));
    const transactionQueries = queries.filter((query) => query.table === "transactions");
    expect(transactionQueries.length).toBeGreaterThan(0);
    for (const { calls } of transactionQueries) {
      expect(has(calls, "eq", "user_id", "user-1")).toBe(true);
      expect(has(calls, "or", "amount.gte.10.00,amount.lte.-10.00")).toBe(true);
      expect(has(calls, "gte", "amount", -50)).toBe(true);
      expect(has(calls, "lte", "amount", 50)).toBe(true);
      expect(has(calls, "eq", "pending", false)).toBe(true);
    }
  });

  it("supports pending-only and ignores malformed amount bounds", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: [] }));
    await loadLedgerRows(input({ supabase: client, filters: { minAmount: "0,amount.gt.0", maxAmount: "-2", status: "pending" } }));
    expect(has(queries[0]!.calls, "eq", "pending", true)).toBe(true);
    expect(queries[0]!.calls.some((call) => ["gte", "lte", "or"].includes(call.method))).toBe(false);
  });
  it("reads one owner-scoped page directly and marks dates cut by the page edge", async () => {
    const page = Array.from({ length: 52 }, (_, index) => row(`t${index}`, index < 2 ? "2026-01-31" : index > 50 ? "2026-01-01" : "2026-01-15"));
    const { client, queries } = fakeSupabase((_table, select) => select === "id,date,amount"
      ? { data: page.slice(0, 51), count: 120 }
      : { data: [] });
    const result = await loadLedgerRows(input({ supabase: client }));
    const direct = queries[0]!;
    expect(direct.table).toBe("transactions");
    expect(has(direct.calls, "eq", "user_id", "user-1")).toBe(true);
    expect(has(direct.calls, "range", 0, 50)).toBe(true);
    expect(result.rows).toHaveLength(50);
    expect(result.total).toBe(120);
    expect([...result.incompleteDates]).toEqual(["2026-01-15"]);
    expect(result.ledgerError).toBe("");
    // Facets come from a separate owner-scoped scan, not the visible page.
    expect(has(queries[1]!.calls, "eq", "user_id", "user-1")).toBe(true);
  });

  it("applies every ledger filter to the review ledger source", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: [] }));
    await loadLedgerRows(input({
      supabase: client,
      params: { category: "UNCATEGORIZED", sub: "FOOD_AND_DRINK_COFFEE", merchant: "Cafe", sort: "amount" },
      filters: {
        transactionReviewEnabled: true, reviewFilter: "needs_review",
        bounds: { start: "2026-01-01", end: "2026-01-31" },
        accountId: "acct-1", transactionsParityEnabled: true, q: "coffee shop",
        flow: "out", accountType: "credit", typedIds: [],
      },
    }));
    const calls = queries[0]!.calls;
    expect(queries[0]!.table).toBe("transaction_review_ledger");
    expect(has(calls, "eq", "review_status", "needs_review")).toBe(true);
    expect(has(calls, "eq", "review_eligible", true)).toBe(true);
    expect(has(calls, "gte", "date", "2026-01-01")).toBe(true);
    expect(has(calls, "lte", "date", "2026-01-31")).toBe(true);
    expect(has(calls, "or", "account_id.eq.acct-1,manual_account_id.eq.acct-1")).toBe(true);
    expect(calls.some((call) => call.method === "or" && String(call.args[0]).includes("pfc_primary.ilike.%coffee_shop%"))).toBe(true);
    expect(has(calls, "gt", "amount", 0)).toBe(true);
    // An account type with no matching accounts must match nothing, not everything.
    expect(has(calls, "in", "account_id", ["missing"])).toBe(true);
    expect(has(calls, "or", "pfc_primary.is.null,pfc_primary.eq.UNCATEGORIZED")).toBe(true);
    expect(has(calls, "eq", "pfc_detailed", "FOOD_AND_DRINK_COFFEE")).toBe(true);
    expect(has(calls, "or", "merchant_name.ilike.Cafe,name.ilike.Cafe")).toBe(true);
  });

  it("uses a plain account filter, inflow and a specific category without parity", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: [] }));
    await loadLedgerRows(input({
      supabase: client,
      params: { category: "FOOD_AND_DRINK" },
      filters: { accountId: "acct-1", flow: "in", accountType: "depository", typedIds: ["acct-1"] },
    }));
    const calls = queries[0]!.calls;
    expect(has(calls, "eq", "account_id", "acct-1")).toBe(true);
    expect(has(calls, "lt", "amount", 0)).toBe(true);
    expect(has(calls, "in", "account_id", ["acct-1"])).toBe(true);
    expect(has(calls, "eq", "pfc_primary", "FOOD_AND_DRINK")).toBe(true);
  });

  it("returns a user-facing error when the page query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeSupabase((_table, select) => select === "id,date,amount" ? { error: { code: "57014" } } : { data: [] });
    const result = await loadLedgerRows(input({ supabase: client }));
    expect(result.rows).toEqual([]);
    expect(result.ledgerError).toMatch(/couldn't load your transactions/);
  });

  it("treats null page, facet and projection results as empty", async () => {
    const direct = await loadLedgerRows(input({ supabase: fakeSupabase(() => ({ data: null })).client }));
    expect(direct.rows).toEqual([]);
    expect(direct.ledgerError).toBe("");
    const projected = await loadLedgerRows(input({ supabase: fakeSupabase(() => ({ data: null })).client, params: { view: "calendar" } }));
    expect(projected.projectedScope).toEqual([]);
    expect(projected.ledgerError).toBe("");
  });

  it("reports a page error that carries no code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeSupabase((_table, select) => select === "id,date,amount" ? { error: { message: "timeout" } } : { data: [] });
    const result = await loadLedgerRows(input({ supabase: client }));
    expect(result.ledgerError).toMatch(/couldn't load your transactions/);
    expect(log).toHaveBeenCalledWith("Transaction page query failed", "unknown");
  });

  it("keeps the page usable when only the facet scan fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeSupabase((_table, select) => select === "id,date,amount"
      ? { data: [row("t1", "2026-01-02")], count: 1 }
      : { error: { message: "facet failure" } });
    const result = await loadLedgerRows(input({ supabase: client }));
    expect(result.rows).toHaveLength(1);
    expect(result.ledgerError).toBe("");
    expect(result.filterOptions).toBeDefined();
  });

  it("projects the whole scope for the calendar view and applies category mappings", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: [row("t1", "2026-01-02"), row("t2", "2026-01-03")] }));
    const result = await loadLedgerRows(input({
      supabase: client,
      params: { view: "calendar" },
      mappings: new Map([["FOOD_AND_DRINK_COFFEE", "Coffee"]]),
    }));
    expect(has(queries[0]!.calls, "order", "date", { ascending: false })).toBe(true);
    expect(has(queries[0]!.calls, "order", "id", { ascending: true })).toBe(true);
    expect(result.projectedScope).toHaveLength(2);
    expect(result.allRowsForGrouping).toHaveLength(2);
    expect(result.rows).toHaveLength(2);
    // The projected scope supplies facets, so no second scan is made.
    expect(queries).toHaveLength(1);
  });

  it("reports a failed projection scan instead of an empty ledger", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeSupabase(() => ({ error: { code: "57014" } }));
    const result = await loadLedgerRows(input({ supabase: client, params: { view: "calendar" } }));
    expect(result.rows).toEqual([]);
    expect(result.ledgerError).toMatch(/couldn't load your transactions/);
  });
});
