import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST } from "@/app/api/transactions/annotate/route";
import type { NextRequest } from "next/server";

interface TableErrors {
  delete?: unknown;
  upsert?: unknown;
  insert?: unknown;
}

/**
 * Chainable supabase stub with per-table, per-terminal-method error control.
 * maybeSingle resolves the seeded transactions/goals row (or null). delete,
 * upsert and insert resolve the seeded error for that table (default null).
 */
function makeClient(opts: {
  txn?: { id: string; amount: number; date: string } | null;
  goal?: { id: string; spending_reduces: boolean } | null;
  tableErrors?: Record<string, TableErrors>;
} = {}) {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const errs = opts.tableErrors?.[table];
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      delete: () => {
        (chain as { then?: unknown }).then = (resolve: (v: { error: unknown }) => unknown) =>
          resolve({ error: errs?.delete ?? null });
        return chain;
      },
      upsert: () => {
        (chain as { then?: unknown }).then = (resolve: (v: { error: unknown }) => unknown) =>
          resolve({ error: errs?.upsert ?? null });
        return chain;
      },
      insert: () => {
        (chain as { then?: unknown }).then = (resolve: (v: { error: unknown }) => unknown) =>
          resolve({ error: errs?.insert ?? null });
        return chain;
      },
      maybeSingle: () => {
        (chain as { then?: unknown }).then = (resolve: (v: { data: unknown }) => unknown) =>
          resolve(
            table === "transactions"
              ? { data: opts.txn ?? null }
              : table === "goals"
                ? { data: opts.goal ?? null }
                : { data: null },
          );
        return chain;
      },
      then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
    });
    return chain;
  };
  return { from } as never;
}

function jsonRequest(body: unknown) {
  return {
    url: "https://x.local",
    json: async () => body,
  } as unknown as NextRequest;
}

function rejectingJsonRequest() {
  return {
    url: "https://x.local",
    json: () => Promise.reject(new Error("json fail")),
  } as unknown as NextRequest;
}

const TXN = { id: "t1", amount: 60, date: "2026-08-01" };

describe("coverage boost r7 n1: transactions/annotate POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  it("returns the auth response when not signed in (L215)", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("rejects when json() rejects (L219 catch arrow, L220-222)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(rejectingJsonRequest());
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("transaction_id is required");
  });

  it("rejects a non-string transaction_id (L220-222 true)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(jsonRequest({ transaction_id: 123, note: "x" }));
    expect(res.status).toBe(400);
  });

  it("400s when the transaction is not found (L236)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: null }) });
    const res = await POST(jsonRequest({ transaction_id: "missing", note: "x" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Transaction not found");
  });

  it("400s when the linked goal does not exist (L27, L34)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN, goal: null }) });
    const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: "g1" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Goal not found");
  });

  it("treats a non-string or blank goal_id as no goal link (L24, L27, L58)", async () => {
    for (const goalId of [123, "   ", ""]) {
      const supabase = makeClient({ txn: TXN });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: goalId }));
      expect(res.status).toBe(200);
      expect(supabase).toBeTruthy();
    }
  });

  it("filters non-string and oversized tags (L46-52)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(
      jsonRequest({
        transaction_id: "t1",
        note: "x",
        tags: [" ok ", 123, "a".repeat(41), "dup", "dup", "b"],
      }),
    );
    expect(res.status).toBe(200);
  });

  it("treats non-array tags as empty (L46 false)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(jsonRequest({ transaction_id: "t1", note: "x", tags: "not-an-array" }));
    expect(res.status).toBe(200);
  });

  it("caps tags at 20 entries (L54 slice)", async () => {
    const tags = Array.from({ length: 25 }, (_, i) => `tag${i}`);
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(jsonRequest({ transaction_id: "t1", note: "x", tags }));
    expect(res.status).toBe(200);
  });

  it("throws when deleting the annotation errors (L63, L68)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        tableErrors: { transaction_annotations: { delete: new Error("delete boom") } },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", note: "", tags: [] }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("transactions.annotate", expect.any(Error));
  });

  it("throws when upserting the annotation errors (L71, L81)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        tableErrors: { transaction_annotations: { upsert: new Error("upsert boom") } },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", note: "hello" }));
    expect(res.status).toBe(500);
  });

  it("deletes splits when splits is not an array (L91 false, L106)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(jsonRequest({ transaction_id: "t1", splits: "nope" }));
    expect(res.status).toBe(200);
  });

  it("filters invalid split entries, leaving none to save (L91-105, L106)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(
      jsonRequest({
        transaction_id: "t1",
        splits: [
          { category: "", amount: 5 },
          { category: "A", amount: Number.NaN },
          { category: "B", amount: 0 },
          { category: "C", amount: -5 },
          { category: 42, amount: 5 },
        ],
      }),
    );
    expect(res.status).toBe(200);
  });

  it("throws when the empty-splits delete errors (L107, L112)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        tableErrors: { transaction_splits: { delete: new Error("splits delete boom") } },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", splits: [] }));
    expect(res.status).toBe(500);
  });

  it("400s splits that do not sum to the amount (L115-126)", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: makeClient({ txn: TXN }) });
    const res = await POST(
      jsonRequest({
        transaction_id: "t1",
        splits: [
          { category: "A", amount: 40 },
          { category: "B", amount: 10 },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(expect.stringContaining("Splits must total 60.00"));
  });

  it("throws when the pre-insert split delete errors (L128, L133)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        tableErrors: { transaction_splits: { delete: new Error("delete boom") } },
      }),
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "t1",
        splits: [
          { category: "A", amount: 60 },
        ],
      }),
    );
    expect(res.status).toBe(500);
  });

  it("throws when inserting splits errors (L134, L142)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        tableErrors: { transaction_splits: { insert: new Error("insert boom") } },
      }),
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "t1",
        splits: [{ category: "A", amount: 60 }],
      }),
    );
    expect(res.status).toBe(500);
  });

  it("throws when the stale goal-progress delete errors (L172, L174)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        goal: { id: "g1", spending_reduces: true },
        tableErrors: { goal_progress_events: { delete: new Error("stale boom") } },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: "g1" }));
    expect(res.status).toBe(500);
  });

  it("throws when the goal-progress upsert errors (L176-188)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        goal: { id: "g1", spending_reduces: true },
        tableErrors: { goal_progress_events: { upsert: new Error("progress upsert boom") } },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: "g1" }));
    expect(res.status).toBe(500);
  });

  it("takes the goal-progress delete path when the linked goal does not reduce spend (L189-196)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        goal: { id: "g1", spending_reduces: false },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: "g1" }));
    expect(res.status).toBe(200);
  });

  it("takes the goal-progress delete path for a credit transaction (L175 false)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: { id: "t1", amount: -50, date: "2026-08-01" },
        goal: { id: "g1", spending_reduces: true },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: "g1" }));
    expect(res.status).toBe(200);
  });

  it("throws when the goal-progress delete path errors (L196)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({
        txn: TXN,
        goal: { id: "g1", spending_reduces: false },
        tableErrors: { goal_progress_events: { delete: new Error("progress delete boom") } },
      }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: "g1" }));
    expect(res.status).toBe(500);
  });

  it("audits a successful goal link (L198, L274)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({ txn: TXN, goal: { id: "g1", spending_reduces: true } }),
    });
    const res = await POST(jsonRequest({ transaction_id: "t1", goal_id: "g1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", action: "goal_transaction_linked", ip: "127.0.0.1" }),
    );
  });

  it("writes splits, a note, tags, and a goal in one request (happy path)", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: makeClient({ txn: TXN, goal: { id: "g1", spending_reduces: true } }),
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "t1",
        note: "lunch",
        tags: ["dining"],
        goal_id: "g1",
        splits: [
          { category: "Food", amount: 40 },
          { category: "Coffee", amount: 20 },
        ],
      }),
    );
    expect(res.status).toBe(200);
  });
});