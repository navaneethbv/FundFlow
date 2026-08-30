import { describe, expect, it } from "vitest";
import {
  deriveProductSyncHealth,
  loadInstitutionObservability,
} from "@/lib/sync-health";
import { clientStub } from "../fixtures/supabase-query";

const NOW = new Date("2026-08-29T12:00:00.000Z");

type FakeRow = Record<string, unknown>;

function queryableSupabase(
  seed: Record<string, FakeRow[]>,
  rpcSeed: Record<string, FakeRow[]> = {},
) {
  const rpcCalls: string[] = [];
  return {
    rpcCalls,
    rpc(name: string) {
      rpcCalls.push(name);
      let start = 0;
      let end: number | null = null;
      const builder = {
        range(from: number, to: number) {
          start = from;
          end = to;
          return builder;
        },
        then(resolve: (value: { data: FakeRow[]; error: null }) => unknown) {
          const last = end === null ? undefined : end + 1;
          return Promise.resolve(resolve({
            data: (rpcSeed[name] ?? []).slice(start, last),
            error: null,
          }));
        },
      };
      return builder;
    },
    from(table: string) {
      let rows = [...(seed[table] ?? [])];
      let start = 0;
      let end: number | null = null;
      let rowLimit: number | null = null;
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[column]));
          return builder;
        },
        gt(column: string, value: unknown) {
          rows = rows.filter((row) => String(row[column]) > String(value));
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          rows.sort((left, right) => {
            const comparison = String(left[column]).localeCompare(String(right[column]));
            return options?.ascending === false ? -comparison : comparison;
          });
          return builder;
        },
        limit(value: number) {
          rowLimit = value;
          return builder;
        },
        range(from: number, to: number) {
          start = from;
          end = to;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: resultRows()[0] ?? null, error: null });
        },
        then(resolve: (value: { data: FakeRow[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: resultRows(), error: null }));
        },
      };
      function resultRows() {
        const last = end === null ? undefined : end + 1;
        const ranged = rows.slice(start, last);
        return rowLimit === null ? ranged : ranged.slice(0, rowLimit);
      }
      return builder;
    },
  };
}

function job(
  status: "pending" | "running" | "done" | "failed",
  updatedAt: string,
  lastError: string | null = null,
) {
  return { status, updated_at: updatedAt, last_error: lastError };
}

describe("deriveProductSyncHealth", () => {
  it("reports never_synced when no attempt exists", () => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: null,
        latestSuccessfulJob: null,
        now: NOW,
      }),
    ).toEqual({
      state: "never_synced",
      lastSuccessAt: null,
      lastAttemptAt: null,
      safeErrorCode: null,
    });
  });

  it("reports healthy and stale from the latest successful completion", () => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: job("done", "2026-08-29T11:00:00.000Z"),
        latestSuccessfulJob: job("done", "2026-08-29T11:00:00.000Z"),
        now: NOW,
      }).state,
    ).toBe("healthy");
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: job("done", "2026-08-26T11:00:00.000Z"),
        latestSuccessfulJob: job("done", "2026-08-26T11:00:00.000Z"),
        now: NOW,
      }).state,
    ).toBe("stale");
  });

  it.each([
    ["RATE_LIMIT_EXCEEDED", "rate_limited"],
    ["PRODUCTS_NOT_SUPPORTED", "product_unavailable"],
    ["ITEM_LOGIN_REQUIRED", "repair_required"],
    ["rate_limited", "rate_limited"],
    ["no_investment_product", "product_unavailable"],
    ["product_not_ready", "repair_required"],
  ] as const)("maps safe provider code %s to %s", (code, state) => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: job("failed", "2026-08-29T11:00:00.000Z", code),
        latestSuccessfulJob: null,
        now: NOW,
      }),
    ).toMatchObject({ state, safeErrorCode: code });
  });

  it("does not expose arbitrary stored error text", () => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "error",
        itemErrorCode: "token=secret customer@example.com",
        latestJob: job("failed", "2026-08-29T11:00:00.000Z", "raw provider payload"),
        latestSuccessfulJob: null,
        now: NOW,
      }),
    ).toMatchObject({ state: "repair_required", safeErrorCode: null });
  });

  it.each([
    ["rate_limited", "rate_limited"],
    ["no_investment_product", "product_unavailable"],
    ["product_not_ready", "repair_required"],
  ] as const)("honors the recorded non-error investment outcome %s", (code, state) => {
    expect(
      deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: job("done", "2026-08-29T11:00:00.000Z", code),
        latestSuccessfulJob: job("done", "2026-08-29T11:00:00.000Z", code),
        now: NOW,
      }),
    ).toMatchObject({ state, safeErrorCode: code });
  });
});

describe("loadInstitutionObservability", () => {
  it("scopes every source query to the authenticated user", async () => {
    const supabase = clientStub({
      accounts: { data: [] },
      sync_jobs: { data: null },
    });

    const result = await loadInstitutionObservability(
      supabase as never,
      "user-1",
      [
        {
          id: "item-1",
          institution_name: "Test Bank",
          status: "active",
          error_code: null,
        },
      ],
      NOW,
    );

    expect(result.institutions[0]).toMatchObject({
      plaidItemId: "item-1",
      transactions: { state: "never_synced" },
      investments: { state: "never_synced" },
    });
    expect(supabase.scopedToUser("accounts", "user-1")).toBe(true);
    expect(supabase.scopedToUser("sync_jobs", "user-1")).toBe(true);
  });

  it("loads product health, bounded coverage, and snapshot-anchored reconciliation", async () => {
    const supabase = queryableSupabase({
      accounts: [
        {
          id: "account-1",
          user_id: "user-1",
          plaid_item_id: "item-1",
          name: "Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          current_balance: 1325,
          updated_at: "2026-08-29T10:00:00.000Z",
        },
      ],
      sync_jobs: [
        {
          user_id: "user-1",
          plaid_item_id: "item-1",
          job_type: "transactions",
          status: "done",
          updated_at: "2026-08-29T11:00:00.000Z",
          last_error: null,
        },
        {
          user_id: "user-1",
          plaid_item_id: "item-1",
          job_type: "investments",
          status: "done",
          updated_at: "2026-08-29T11:30:00.000Z",
          last_error: "no_investment_product",
        },
      ],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "account-1", date: "2026-08-02", amount: -500 },
        { id: "txn-2", user_id: "user-1", account_id: "account-1", date: "2026-08-03", amount: 175 },
      ],
    }, {
      account_reconciliation_aggregates: [
        {
          account_id: "account-1",
          snapshot_date: "2026-08-01",
          snapshot_balance_cents: 100000,
          post_anchor_total_cents: -32500,
          oldest_transaction_date: "2026-08-02",
          newest_transaction_date: "2026-08-03",
        },
      ],
    });

    const result = await loadInstitutionObservability(
      supabase as never,
      "user-1",
      [{ id: "item-1", institution_name: "Test Bank", status: "active", error_code: null }],
      NOW,
    );

    expect(result.institutions[0]).toMatchObject({
      transactions: { state: "healthy" },
      investments: { state: "product_unavailable" },
      accountsUpdatedAt: "2026-08-29T10:00:00.000Z",
      oldestTransactionDate: "2026-08-02",
      newestTransactionDate: "2026-08-03",
    });
    expect(result.reconciliations[0]).toMatchObject({
      providerBalance: 1325,
      ledgerBalance: 1325,
      difference: 0,
      state: "balanced",
      oldestTransactionDate: "2026-08-02",
      newestTransactionDate: "2026-08-03",
    });
    expect(supabase.rpcCalls).toEqual(["account_reconciliation_aggregates"]);
  });

  it("keeps transaction coverage scoped to each account", async () => {
    const supabase = queryableSupabase({
      accounts: [
        {
          id: "account-1", user_id: "user-1", plaid_item_id: "item-1",
          name: "Checking", mask: null, type: "depository", subtype: "checking",
          current_balance: 100, updated_at: "2026-08-29T10:00:00.000Z",
        },
        {
          id: "account-2", user_id: "user-1", plaid_item_id: "item-1",
          name: "Savings", mask: null, type: "depository", subtype: "savings",
          current_balance: 200, updated_at: "2026-08-29T10:00:00.000Z",
        },
      ],
      sync_jobs: [],
      transactions: [
        { id: "txn-1", user_id: "user-1", account_id: "account-1", date: "2026-01-01" },
        { id: "txn-2", user_id: "user-1", account_id: "account-2", date: "2026-08-01" },
      ],
    }, {
      account_reconciliation_aggregates: [
        {
          account_id: "account-1", snapshot_date: "2026-07-01",
          snapshot_balance_cents: 10000, post_anchor_total_cents: 0,
          oldest_transaction_date: "2026-01-01", newest_transaction_date: "2026-01-31",
        },
        {
          account_id: "account-2", snapshot_date: "2026-07-01",
          snapshot_balance_cents: 20000, post_anchor_total_cents: 0,
          oldest_transaction_date: "2026-08-01", newest_transaction_date: "2026-08-29",
        },
      ],
    });

    const result = await loadInstitutionObservability(
      supabase as never,
      "user-1",
      [{ id: "item-1", institution_name: "Test Bank", status: "active", error_code: null }],
      NOW,
    );

    expect(result.reconciliations.map((row) => [
      row.accountId,
      row.oldestTransactionDate,
      row.newestTransactionDate,
    ])).toEqual([
      ["account-1", "2026-01-01", "2026-01-31"],
      ["account-2", "2026-08-01", "2026-08-29"],
    ]);
  });

  it("does not invent a zero-dollar anchor from a null snapshot balance", async () => {
    const supabase = queryableSupabase({
      accounts: [{
        id: "account-1", user_id: "user-1", plaid_item_id: "item-1",
        name: "Checking", mask: null, type: "depository", subtype: "checking",
        current_balance: 100, updated_at: "2026-08-29T10:00:00.000Z",
      }],
      sync_jobs: [],
    }, {
      account_reconciliation_aggregates: [{
        account_id: "account-1",
        snapshot_date: "2026-08-01",
        snapshot_balance_cents: null,
        post_anchor_total_cents: 0,
        oldest_transaction_date: null,
        newest_transaction_date: null,
      }],
    });

    const result = await loadInstitutionObservability(
      supabase as never,
      "user-1",
      [{ id: "item-1", institution_name: "Test Bank", status: "active", error_code: null }],
      NOW,
    );

    expect(result.reconciliations[0]).toMatchObject({
      anchorDate: null,
      ledgerBalance: null,
      state: "missing_anchor",
    });
  });

  it("keeps Settings usable while the reconciliation RPC migration is pending", async () => {
    const supabase = queryableSupabase({
      accounts: [{
        id: "account-1", user_id: "user-1", plaid_item_id: "item-1",
        name: "Checking", mask: null, type: "depository", subtype: "checking",
        current_balance: 100, updated_at: "2026-08-29T10:00:00.000Z",
      }],
      sync_jobs: [],
    });
    supabase.rpc = ((name: string) => {
      supabase.rpcCalls.push(name);
      return {
        range: () => Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "Function not found" },
        }),
      };
    }) as unknown as typeof supabase.rpc;

    const result = await loadInstitutionObservability(
      supabase as never,
      "user-1",
      [{ id: "item-1", institution_name: "Test Bank", status: "active", error_code: null }],
      NOW,
    );

    expect(result.institutions).toHaveLength(1);
    expect(result.reconciliations[0]).toMatchObject({
      accountId: "account-1",
      state: "missing_anchor",
    });
  });

  it("pages reconciliation aggregates beyond the database response cap", async () => {
    const aggregates = Array.from({ length: 1_001 }, (_, index) => ({
      account_id: `account-${index}`,
      snapshot_date: null,
      snapshot_balance_cents: null,
      post_anchor_total_cents: 0,
      oldest_transaction_date: null,
      newest_transaction_date: null,
    }));
    const supabase = queryableSupabase({ accounts: [], sync_jobs: [] }, {
      account_reconciliation_aggregates: aggregates,
    });

    await loadInstitutionObservability(supabase as never, "user-1", [], NOW);

    expect(supabase.rpcCalls).toEqual([
      "account_reconciliation_aggregates",
      "account_reconciliation_aggregates",
    ]);
  });
});
