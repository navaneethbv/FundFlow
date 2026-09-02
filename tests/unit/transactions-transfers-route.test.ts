import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "@/app/api/transactions/transfers/route";
import { requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";

const from = vi.fn();

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));

const OUT_ID = "11111111-1111-1111-1111-111111111101";
const IN_ID = "11111111-1111-1111-1111-111111111102";
const SUBJECT = `${OUT_ID}:${IN_ID}`;

function thenable(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error }),
  };
  for (const method of ["select", "eq", "gte", "limit", "upsert", "in", "flat"]) {
    builder[method] = () => builder;
  }
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: "user-123" },
    supabase: { from } as never,
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
    const upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    from.mockImplementation((table: string) => {
      if (table === "transaction_review_decisions") {
        return { upsert };
      }
      if (table === "transactions") return thenable([{ id: OUT_ID }, { id: IN_ID }]);
      return { upsert };
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
    expect(res.status).toBe(200);
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
