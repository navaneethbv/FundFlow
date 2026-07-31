import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 7 goal linking on the ledger editor.
 *
 * The shared mock in annotate-route.test.ts returns one row shape for every
 * table, which cannot express "this is the transaction, that is the goal", so
 * this suite brings its own table-aware recorder.
 */

interface Recorded {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<{ method: string; column: string; value: unknown }>;
}

function makeClient(options: {
  txn: { id: string; amount: number; date: string } | null;
  goal?: { id: string; spending_reduces: boolean } | null;
}) {
  const calls: Recorded[] = [];

  const from = (table: string) => {
    const record: Recorded = { table, op: "select", filters: [] };
    calls.push(record);

    const chain: Record<string, unknown> = {};
    const resolveValue = () => {
      if (table === "transactions") return { data: options.txn, error: null };
      if (table === "goals") return { data: options.goal ?? null, error: null };
      return { data: null, error: null };
    };
    Object.assign(chain, {
      select: () => chain,
      delete: () => {
        record.op = "delete";
        return chain;
      },
      upsert: (payload: unknown) => {
        record.op = "upsert";
        record.payload = payload;
        return Promise.resolve({ error: null });
      },
      insert: (payload: unknown) => {
        record.op = "insert";
        record.payload = payload;
        return Promise.resolve({ error: null });
      },
      eq: (column: string, value: unknown) => {
        record.filters.push({ method: "eq", column, value });
        return chain;
      },
      neq: (column: string, value: unknown) => {
        record.filters.push({ method: "neq", column, value });
        return chain;
      },
      maybeSingle: () => Promise.resolve(resolveValue()),
      then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
    });
    return chain;
  };

  return { client: { from } as never, calls };
}

const { mockRequireUser } = vi.hoisted(() => ({ mockRequireUser: vi.fn() }));

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return { ...actual, requireUser: mockRequireUser };
});
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  getClientIp: vi.fn(() => null),
}));

import { POST } from "@/app/api/transactions/annotate/route";
import { writeAudit } from "@/lib/audit";

const TXN = { id: "txn-1", amount: 42.5, date: "2026-07-10" };
const GOAL_ID = "goal-1";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/transactions/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

function setup(options: Parameters<typeof makeClient>[0]) {
  const made = makeClient(options);
  mockRequireUser.mockResolvedValue({
    user: { id: "user-1", email: "u@example.com" },
    supabase: made.client,
  });
  return made;
}

function eventWrites(calls: Recorded[]) {
  return calls.filter(
    (call) => call.table === "goal_progress_events" && call.op === "upsert",
  );
}

describe("annotate route goal linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves the link untouched when goal_id is absent", async () => {
    const { calls } = setup({ txn: TXN });
    const response = await post({ transaction_id: TXN.id, note: "lunch" });

    expect(response.status).toBe(200);
    // No goal lookup, no ledger write, no audit — an unrelated note edit must
    // not disturb an existing link.
    expect(calls.some((call) => call.table === "goals")).toBe(false);
    expect(calls.some((call) => call.table === "goal_progress_events")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a goal the caller does not own", async () => {
    setup({ txn: TXN, goal: null });
    const response = await post({ transaction_id: TXN.id, goal_id: GOAL_ID });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Goal not found",
    });
  });

  it("checks goal ownership by user, not just visibility", async () => {
    const { calls } = setup({
      txn: TXN,
      goal: { id: GOAL_ID, spending_reduces: false },
    });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });

    const goalLookup = calls.find((call) => call.table === "goals")!;
    expect(goalLookup.filters).toContainEqual({
      method: "eq",
      column: "user_id",
      value: "user-1",
    });
  });

  it("keeps the annotation row alive for a link with no note or tags", async () => {
    const { calls } = setup({
      txn: TXN,
      goal: { id: GOAL_ID, spending_reduces: false },
    });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });

    const annotation = calls.find(
      (call) => call.table === "transaction_annotations",
    )!;
    // Deleting it because note and tags are empty would silently drop the link.
    expect(annotation.op).toBe("upsert");
    expect(annotation.payload).toMatchObject({ goal_id: GOAL_ID });
  });

  it("clears the link and the annotation when goal_id is explicitly null", async () => {
    const { calls } = setup({ txn: TXN });
    await post({ transaction_id: TXN.id, goal_id: null });

    const annotation = calls.find(
      (call) => call.table === "transaction_annotations",
    )!;
    expect(annotation.op).toBe("delete");
  });

  it("writes a negative event for a spending-reduces goal on an expense", async () => {
    const { calls } = setup({
      txn: TXN,
      goal: { id: GOAL_ID, spending_reduces: true },
    });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });

    const [event] = eventWrites(calls);
    expect(event!.payload).toMatchObject({
      user_id: "user-1",
      goal_id: GOAL_ID,
      transaction_id: TXN.id,
      event_date: "2026-07-10",
      // Money spent sets the goal back, so the event is negative.
      amount: -42.5,
      event_type: "transaction",
    });
  });

  it("writes no event when the goal does not reduce on spend", async () => {
    const { calls } = setup({
      txn: TXN,
      goal: { id: GOAL_ID, spending_reduces: false },
    });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });
    expect(eventWrites(calls)).toHaveLength(0);
  });

  it("writes no event when the linked transaction is income", async () => {
    // Plaid convention: negative is money in, which is not spending.
    const { calls } = setup({
      txn: { ...TXN, amount: -900 },
      goal: { id: GOAL_ID, spending_reduces: true },
    });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });
    expect(eventWrites(calls)).toHaveLength(0);
  });

  it("clears an event left on a previously linked goal", async () => {
    const { calls } = setup({
      txn: TXN,
      goal: { id: GOAL_ID, spending_reduces: true },
    });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });

    const stale = calls.find(
      (call) => call.table === "goal_progress_events" && call.op === "delete",
    )!;
    // Scoped to this transaction, excluding the goal it now points at, so
    // re-pointing cannot leave progress behind on the old goal.
    expect(stale.filters).toContainEqual({
      method: "eq",
      column: "transaction_id",
      value: TXN.id,
    });
    expect(stale.filters).toContainEqual({
      method: "neq",
      column: "goal_id",
      value: GOAL_ID,
    });
  });

  it("removes every event for the transaction when the link is cleared", async () => {
    const { calls } = setup({ txn: TXN });
    await post({ transaction_id: TXN.id, goal_id: null });

    const stale = calls.find(
      (call) => call.table === "goal_progress_events" && call.op === "delete",
    )!;
    expect(stale.filters).toContainEqual({
      method: "eq",
      column: "transaction_id",
      value: TXN.id,
    });
    // Nothing is being kept, so there is no goal to exclude.
    expect(stale.filters.some((filter) => filter.method === "neq")).toBe(false);
  });

  it("is idempotent: the event is upserted on the goal/transaction pair", async () => {
    const { calls } = setup({
      txn: TXN,
      goal: { id: GOAL_ID, spending_reduces: true },
    });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });
    // The unique (goal_id, transaction_id) constraint plus an upsert means
    // linking twice updates one row rather than adding a second.
    expect(eventWrites(calls)).toHaveLength(1);
  });

  it("audits the link with ids only", async () => {
    setup({ txn: TXN, goal: { id: GOAL_ID, spending_reduces: true } });
    await post({ transaction_id: TXN.id, goal_id: GOAL_ID });

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "goal_transaction_linked",
        metadata: { transaction_id: TXN.id, goal_id: GOAL_ID },
      }),
    );
  });
});
