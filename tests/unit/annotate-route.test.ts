import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Recording mock of the RLS-scoped Supabase client. Every builder method is
 * chainable and awaitable; select().eq().maybeSingle() returns the owned
 * transaction, and insert() records its rows so the test can assert whether
 * splits were written.
 */
function makeClient(txn: { id: string; amount: number } | null) {
  const inserts: unknown[] = [];
  const from = () => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      delete: () => chain,
      maybeSingle: () => Promise.resolve({ data: txn }),
      upsert: () => Promise.resolve({ error: null }),
      insert: (rows: unknown) => {
        inserts.push(rows);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
    });
    return chain;
  };
  return { client: { from } as never, inserts };
}

const { mockRequireUser } = vi.hoisted(() => ({ mockRequireUser: vi.fn() }));

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return { ...actual, requireUser: mockRequireUser };
});

import { POST } from "@/app/api/transactions/annotate/route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/transactions/annotate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

describe("POST /api/transactions/annotate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects splits that do not sum to the transaction amount", async () => {
    const { client, inserts } = makeClient({ id: "t1", amount: 60 });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await post({
      transaction_id: "t1",
      splits: [
        { category: "A", amount: 40 },
        { category: "B", amount: 10 },
      ],
    });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("writes splits that balance to the transaction amount", async () => {
    const { client, inserts } = makeClient({ id: "t1", amount: 60 });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await post({
      transaction_id: "t1",
      splits: [
        { category: "A", amount: 40 },
        { category: "B", amount: 20 },
      ],
    });
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual([
      { user_id: "u1", transaction_id: "t1", category: "A", amount: 40 },
      { user_id: "u1", transaction_id: "t1", category: "B", amount: 20 },
    ]);
  });

  it("404s (400) when the transaction is not the caller's", async () => {
    const { client } = makeClient(null);
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });
    const res = await post({ transaction_id: "not-mine", note: "x" });
    expect(res.status).toBe(400);
  });
});
