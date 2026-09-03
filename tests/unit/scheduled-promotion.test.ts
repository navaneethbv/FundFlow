import { beforeEach, describe, expect, it, vi } from "vitest";
import { promoteDueScheduledTransactions } from "@/lib/scheduled-promotion";

const DUE = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "user-123",
  kind: "debit",
  amount: "500.00",
  merchant: "Landlord",
  scheduled_date: "2026-09-01",
  category: "rent",
  account_id: "acc-1",
  manual_account_id: null,
  status: "scheduled",
};

function serviceStub({
  due = [DUE],
  upsertError = null,
  statusError = null,
  insertedRows,
}: { due?: unknown[]; upsertError?: unknown; statusError?: unknown; insertedRows?: unknown[] } = {}) {
  const calls = { upserts: [] as unknown[][], statusUpdates: [] as unknown[] };
  const service = {
    from: vi.fn((table: string) => {
      if (table === "scheduled_transactions") {
        return {
          select: () => chain,
          update: (values: unknown) => {
            calls.statusUpdates.push(values);
            // The write path awaits .in(...), not the builder itself.
            return { in: () => Promise.resolve({ data: null, error: statusError }) };
          },
        };
      }
      if (table === "transactions") {
        return {
          upsert: (rows: unknown[]) => {
            calls.upserts.push(rows);
            const data = upsertError ? null : (insertedRows ?? rows.map(() => ({ id: "1" })));
            return {
              select: () => Promise.resolve({ data, error: upsertError }),
              then: (resolve: (value: unknown) => unknown) => resolve({ data, error: upsertError }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  // The read chain: select() returns a builder that is thenable and supports
  // eq/lte/order/limit before resolving to the seeded rows.
  const chain = {
    eq: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (value: unknown) => unknown) => resolve({ data: due, error: null }),
  };
  return { service, calls };
}

describe("promoteDueScheduledTransactions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("promotes due rows into transactions with deterministic ids and marks them promoted", async () => {
    const { service, calls } = serviceStub();
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result).toEqual({ promoted: 1, failed: null });
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0][0]).toMatchObject({
      user_id: "user-123",
      plaid_transaction_id: `scheduled-${DUE.id}`,
      amount: 500,
      date: "2026-09-01",
      source: "manual",
    });
    expect(calls.statusUpdates).toEqual([{ status: "promoted" }]);
  });

  it("is a no-op when nothing is due", async () => {
    const { service, calls } = serviceStub({ due: [] });
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result).toEqual({ promoted: 0, failed: null });
    expect(calls.upserts).toHaveLength(0);
    expect(calls.statusUpdates).toHaveLength(0);
  });

  it("filters out non-scheduled rows returned by the query", async () => {
    const { service, calls } = serviceStub({
      due: [DUE, { ...DUE, id: "22222222-2222-2222-2222-222222222222", status: "promoted" }],
    });
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result.promoted).toBe(1);
    expect(calls.upserts[0]).toHaveLength(1);
  });

  it("reports an insert failure without marking rows promoted", async () => {
    const { service, calls } = serviceStub({ upsertError: { message: "boom" } });
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result.failed).toBe("boom");
    expect(calls.statusUpdates).toHaveLength(0);
  });

  it("reports 0 promoted when upsert skips duplicate rows", async () => {
    const { service } = serviceStub({ insertedRows: [] });
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result.promoted).toBe(0);
    expect(result.failed).toBeNull();
  });
});

describe("promoteDueScheduledTransactions — remaining branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters rows missing a usable user_id", async () => {
    const { service, calls } = serviceStub({
      due: [DUE, { ...DUE, id: "33333333-3333-3333-3333-333333333333", user_id: null }],
    });
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result.promoted).toBe(1);
    expect(calls.upserts[0]).toHaveLength(1);
  });

  it("reports a status-update failure after writing the ledger rows", async () => {
    const { service } = serviceStub({ statusError: { message: "status failed" } });
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result.promoted).toBe(1);
    expect(result.failed).toBe("status failed");
  });

  it("reports a read error when querying scheduled_transactions fails", async () => {
    const service = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            lte: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: null, error: { message: "db unavailable" } }),
              }),
            }),
          }),
        }),
      })),
    };
    const result = await promoteDueScheduledTransactions(service as never, "2026-09-02");
    expect(result).toEqual({ promoted: 0, failed: "db unavailable" });
  });
});

