import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "@/app/api/transactions/transfers/route";
import { requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";

const from = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));

const OUT_ID = "11111111-1111-1111-1111-111111111101";
const IN_ID = "11111111-1111-1111-1111-111111111102";
const SUBJECT = `${OUT_ID}:${IN_ID}`;
const OUT_ID_2 = "22222222-2222-2222-2222-222222222201";
const IN_ID_2 = "22222222-2222-2222-2222-222222222202";
const SUBJECT_2 = `${OUT_ID_2}:${IN_ID_2}`;
const OUT_ID_AFTER_IN_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const IN_ID_BEFORE_OUT_ID = "00000000-0000-0000-0000-000000000000";
const DIRECTION_INDEPENDENT_SUBJECT = `${IN_ID_BEFORE_OUT_ID}:${OUT_ID_AFTER_IN_ID}`;

function thenable(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error }),
  };
  for (const method of ["select", "eq", "gte", "order", "range", "limit", "upsert", "in", "or", "flat"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function ownedRowsThenable<T extends { id: string }>(rows: T[]) {
  let requestedIds: string[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: rows.filter((row) => requestedIds.includes(row.id)), error: null }),
    in: (_column: string, ids: string[]) => {
      requestedIds = ids;
      return builder;
    },
  };
  for (const method of ["select", "eq", "gte", "order", "range"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function pagedThenable(pages: unknown[][]) {
  let page = 0;
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: pages[page++] ?? [], error: null }),
  };
  for (const method of ["select", "eq", "gte", "order", "range"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function mockOwnedTransferPair({
  outId = OUT_ID,
  inId = IN_ID,
  outAmount = 500,
  inAmount = -500,
}: {
  outId?: string;
  inId?: string;
  outAmount?: number | string;
  inAmount?: number | string;
} = {}) {
  from.mockImplementation((table: string) => {
    if (table === "transactions") {
      return thenable([
        { id: outId, date: "2026-09-01", amount: outAmount, account_id: "a1", manual_account_id: null },
        { id: inId, date: "2026-09-02", amount: inAmount, account_id: "a2", manual_account_id: null },
      ]);
    }
    if (table === "linked_transfers") return { select: () => thenable([]) };
    throw new Error(`unexpected ${table}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: "user-123" },
    supabase: { from, rpc } as never,
  } as never);
});

describe("GET /api/transactions/transfers", () => {
  it("returns detected, undecided, unlinked pairs", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
        ]);
      }
      if (table === "transaction_review_decisions") return thenable([]);
      if (table === "linked_transfers") return thenable([]);
      throw new Error(`unexpected ${table}`);
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pairs: Array<{ subject_id: string }> };
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0]!.subject_id).toBe(SUBJECT);
  });

  it("hides dismissed pairs and already-linked rows", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
        ]);
      }
      if (table === "transaction_review_decisions") {
        return thenable([{ subject_id: SUBJECT, decision: "dismissed" }]);
      }
      return thenable([]);
    });
    const res = await GET();
    const body = (await res.json()) as { pairs: unknown[] };
    expect(body.pairs).toEqual([]);
  });
});

describe("POST /api/transactions/transfers", () => {
  it("dismisses without linking", async () => {
    const upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    from.mockReturnValue({ upsert });
    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({ subject_id: SUBJECT, decision: "dismissed" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "transfer", subject_id: SUBJECT, decision: "dismissed" }),
      expect.anything(),
    );
  });

  it("confirms only when both sides are the caller's own rows", async () => {
    mockOwnedTransferPair();
    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          subject_id: SUBJECT,
          decision: "confirmed",
          out_id: OUT_ID,
          in_id: IN_ID,
          amount: 500,
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("uses a direction-independent subject when the outgoing UUID sorts after the incoming UUID", async () => {
    mockOwnedTransferPair({ outId: OUT_ID_AFTER_IN_ID, inId: IN_ID_BEFORE_OUT_ID });

    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          subject_id: DIRECTION_INDEPENDENT_SUBJECT,
          decision: "confirmed",
          out_id: OUT_ID_AFTER_IN_ID,
          in_id: IN_ID_BEFORE_OUT_ID,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "confirm_transfer_link",
      expect.objectContaining({
        p_subject_id: DIRECTION_INDEPENDENT_SUBJECT,
        p_out_transaction_id: OUT_ID_AFTER_IN_ID,
        p_in_transaction_id: IN_ID_BEFORE_OUT_ID,
      }),
    );
  });

  it("validates the current pair before persisting a confirmed decision", async () => {
    const decisionUpsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    from.mockImplementation((table: string) => {
      if (table === "transactions") return thenable([
        { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
        { id: IN_ID, date: "2026-09-02", amount: 500, account_id: "a2", manual_account_id: null },
      ]);
      if (table === "transaction_review_decisions") return { upsert: decisionUpsert };
      if (table === "linked_transfers") return { upsert: vi.fn() };
      throw new Error(`unexpected ${table}`);
    });

    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          subject_id: SUBJECT,
          decision: "confirmed",
          out_id: OUT_ID,
          in_id: IN_ID,
          amount: 500,
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(decisionUpsert).not.toHaveBeenCalled();
  });

  it("derives the linked amount from the owned transactions", async () => {
    mockOwnedTransferPair();

    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          subject_id: SUBJECT,
          decision: "confirmed",
          out_id: OUT_ID,
          in_id: IN_ID,
          amount: 1,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "confirm_transfer_link",
      expect.objectContaining({ p_amount: 500 }),
    );
  });

  it("coerces string amounts and links successfully without requiring body amount", async () => {
    mockOwnedTransferPair({ outAmount: "500.00", inAmount: "-500.00" });

    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          subject_id: SUBJECT,
          decision: "confirmed",
          out_id: OUT_ID,
          in_id: IN_ID,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "confirm_transfer_link",
      expect.objectContaining({ p_amount: 500 }),
    );
  });

  it("fails closed when transaction amounts are not finite numbers", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") return thenable([
        { id: OUT_ID, date: "2026-09-01", amount: "not-a-number", account_id: "a1", manual_account_id: null },
        { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
      ]);
      throw new Error(`unexpected ${table}`);
    });

    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          subject_id: SUBJECT,
          decision: "confirmed",
          out_id: OUT_ID,
          in_id: IN_ID,
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("rejects a subject that does not match the pair", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          subject_id: `${IN_ID}:${OUT_ID}`,
          decision: "confirmed",
          out_id: OUT_ID,
          in_id: IN_ID,
          amount: 500,
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("429s past the rate limit", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false as never);
    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({ subject_id: SUBJECT, decision: "dismissed" }),
      }),
    );
    expect(res.status).toBe(429);
  });

  it("links a bounded bulk request while validating every pair", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(true as never);
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return ownedRowsThenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
          { id: OUT_ID_2, date: "2026-09-03", amount: 75, account_id: "a3", manual_account_id: null },
          { id: IN_ID_2, date: "2026-09-04", amount: -75, account_id: "a4", manual_account_id: null },
        ]);
      }
      if (table === "linked_transfers") return { select: () => thenable([]) };
      throw new Error(`unexpected ${table}`);
    });

    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          decision: "confirmed",
          transfers: [
            { subject_id: SUBJECT, out_id: OUT_ID, in_id: IN_ID },
            { subject_id: SUBJECT_2, out_id: OUT_ID_2, in_id: IN_ID_2 },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      linked: [SUBJECT, SUBJECT_2],
      failures: [],
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(checkRateLimit).toHaveBeenCalledWith("transfers:user-123:bulk", 5, 3600);
  });

  it("reports partial bulk failures without hiding successful links", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(true as never);
    mockOwnedTransferPair();

    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          decision: "confirmed",
          transfers: [
            { subject_id: SUBJECT, out_id: OUT_ID, in_id: IN_ID },
            null,
            { subject_id: "wrong-subject", out_id: OUT_ID, in_id: IN_ID },
          ],
        }),
      }),
    );

    expect(res.status).toBe(207);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      linked: [SUBJECT],
      failures: [
        { subject_id: null, error: "Each transfer must be an object." },
        { subject_id: "wrong-subject", error: "subject_id does not match the pair" },
      ],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects empty or oversized bulk requests", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(true as never);
    const invalidDecision = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({ decision: "dismissed", transfers: [null] }),
      }),
    );
    expect(invalidDecision.status).toBe(400);

    const empty = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({ decision: "confirmed", transfers: [] }),
      }),
    );
    expect(empty.status).toBe(400);

    const oversized = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({
          decision: "confirmed",
          transfers: Array.from({ length: 101 }, () => null),
        }),
      }),
    );
    expect(oversized.status).toBe(400);
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({ subject_id: SUBJECT, decision: "dismissed" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/transactions/transfers — remaining branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from, rpc } as never,
    } as never);
    vi.mocked(checkRateLimit).mockResolvedValue(true as never);
  });

  it("returns the auth response when signed out (GET and POST)", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    expect((await GET()).status).toBe(401);
    const res = await POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify({ subject_id: SUBJECT, decision: "dismissed" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("429s past the read rate limit", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false as never);
    const res = await GET();
    expect(res.status).toBe(429);
  });

  it("handles null query payloads and missing ids on rows", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") return thenable(null);
      return thenable(null);
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pairs: unknown[] };
    expect(body.pairs).toEqual([]);
  });

  it("hides rows already linked via linked_transfers", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
        ]);
      }
      if (table === "transaction_review_decisions") return thenable([]);
      if (table === "linked_transfers") {
        return thenable([{ out_transaction_id: OUT_ID, in_transaction_id: IN_ID }]);
      }
      throw new Error(`unexpected ${table}`);
    });
    const res = await GET();
    const body = (await res.json()) as { pairs: unknown[] };
    expect(body.pairs).toEqual([]);
  });

  it("resolves account ids from manual accounts and renders null dates", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: null, manual_account_id: "m1" },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: null, manual_account_id: "m2" },
        ]);
      }
      return thenable([]);
    });
    const res = await GET();
    const body = (await res.json()) as { pairs: Array<{ out_date: string | null }> };
    expect(body.pairs).toHaveLength(1);
  });

  it("pairs rows with no account reference at all (two distinct blank accounts)", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: null, manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: null, manual_account_id: null },
        ]);
      }
      return thenable([]);
    });
    const res = await GET();
    const body = (await res.json()) as { pairs: unknown[] };
    // Both sides resolve to "" — same (missing) account, so no pair.
    expect(body.pairs).toEqual([]);
  });

  it("returns an error when a paged ledger query fails", async () => {
    from.mockImplementation((table: string) =>
      table === "transactions"
        ? thenable(null, { message: "ledger unavailable" })
        : thenable([]),
    );

    const res = await GET();

    expect(res.status).toBe(500);
  });

  it("loads a full first page before stopping on the next page", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      id: `transaction-${index}`,
      date: "2026-09-01",
      amount: 1,
      account_id: "account-1",
      manual_account_id: null,
    }));
    const transactions = pagedThenable([firstPage, []]);
    from.mockImplementation((table: string) => {
      if (table === "transactions") return transactions;
      return thenable([]);
    });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pairs: [] });
  });
});

describe("POST /api/transactions/transfers — validation branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-123" },
      supabase: { from, rpc } as never,
    } as never);
    vi.mocked(checkRateLimit).mockResolvedValue(true as never);
  });

  function post(body: Record<string, unknown>) {
    return POST(
      new NextRequest("http://localhost/api/transactions/transfers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  it("400s on a missing subject or invalid decision", async () => {
    expect((await post({ subject_id: SUBJECT })).status).toBe(400);
    expect((await post({ subject_id: SUBJECT, decision: "maybe" })).status).toBe(400);
  });

  it("propagates a decision upsert failure", async () => {
    from.mockImplementation(() => ({
      upsert: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    }));
    const res = await post({ subject_id: SUBJECT, decision: "dismissed" });
    expect(res.status).toBe(500);
  });

  it("400s when confirm lacks ids or amount, or repeats one transaction", async () => {
    from.mockReturnValue({
      upsert: () => Promise.resolve({ data: null, error: null }),
    });
    expect(
      (await post({ subject_id: SUBJECT, decision: "confirmed", amount: 500 })).status,
    ).toBe(400);
    expect(
      (await post({ subject_id: SUBJECT, decision: "confirmed", out_id: OUT_ID, in_id: OUT_ID, amount: 500 }))
        .status,
    ).toBe(400);
  });

  it("propagates ownership and link write failures", async () => {
    // Ownership read failure.
    from.mockImplementation((table: string) => {
      if (table === "transaction_review_decisions") {
        return { upsert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === "transactions") {
        return thenable(null, { message: "verify failed" });
      }
      throw new Error(`unexpected ${table}`);
    });
    const res = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
      amount: 500,
    });
    expect(res.status).toBe(500);

    // Link write failure after ownership passes.
    from.mockImplementation((table: string) => {
      if (table === "transaction_review_decisions") {
        return { upsert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === "transactions") return thenable([{ id: OUT_ID, amount: 500 }, { id: IN_ID, amount: -500 }]);
      return { upsert: () => Promise.resolve({ data: null, error: { message: "link failed" } }) };
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "link failed" } });
    const res2 = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
      amount: 500,
    });
    expect(res2.status).toBe(500);
  });

  it("400s when ownership finds fewer than both rows", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transaction_review_decisions") {
        return { upsert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === "transactions") return thenable([{ id: OUT_ID }]);
      throw new Error(`unexpected ${table}`);
    });
    const res = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
      amount: 500,
    });
    expect(res.status).toBe(400);
  });

  it("400s when both transactions belong to the same account", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transaction_review_decisions") {
        return { upsert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "same-acc", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "same-acc", manual_account_id: null },
        ]);
      }
      throw new Error(`unexpected ${table}`);
    });
    const res = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
      amount: 500,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("different accounts");
  });

  it("400s when transactions are outside the 7-day window", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transaction_review_decisions") {
        return { upsert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-15", amount: -500, account_id: "a2", manual_account_id: null },
        ]);
      }
      throw new Error(`unexpected ${table}`);
    });
    const res = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
      amount: 500,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("7 days");
  });

  it("rejects a pair that is already linked to another transfer", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
        ]);
      }
      if (table === "linked_transfers") {
        return thenable([{ out_transaction_id: "other-out", in_transaction_id: IN_ID }]);
      }
      return thenable([]);
    });

    const res = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("already linked") });
  });

  it("surfaces a linked-transfer lookup failure", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
        ]);
      }
      if (table === "linked_transfers") return thenable(null, { message: "linked lookup failed" });
      return thenable([]);
    });

    const res = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
    });

    expect(res.status).toBe(500);
  });

  it("returns a conflict when the atomic confirmation reports a race", async () => {
    from.mockImplementation((table: string) => {
      if (table === "transactions") {
        return thenable([
          { id: OUT_ID, date: "2026-09-01", amount: 500, account_id: "a1", manual_account_id: null },
          { id: IN_ID, date: "2026-09-02", amount: -500, account_id: "a2", manual_account_id: null },
        ]);
      }
      return thenable([]);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "transfer_link_conflict: already linked" },
    });

    const res = await post({
      subject_id: SUBJECT,
      decision: "confirmed",
      out_id: OUT_ID,
      in_id: IN_ID,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "One of these transactions is already linked to another transfer.",
    });
  });
});
