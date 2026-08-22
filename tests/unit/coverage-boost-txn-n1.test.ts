import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockBadRequest = vi.fn((message: string) =>
  NextResponse.json({ error: message }, { status: 400 }),
);
const mockErrorResponse = vi.fn((_context: string, error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "error" },
    { status: 500 },
  ),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (...a: unknown[]) => mockBadRequest(...(a as [string])),
  errorResponse: (context: string, error: unknown) => mockErrorResponse(context, error),
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  () => Promise.resolve(true),
);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockValidateSplits = vi.fn(() => ({ valid: true, difference: 0 }));
const mockDetectDuplicatePairs = vi.fn(() => []);
const mockDuplicateSubjectId = vi.fn(
  (a: string, b: string) => `${a}:${b}`,
);
const mockFilterReviewDecisions = vi.fn((anomalies: unknown[]) => anomalies);
vi.mock("@/lib/transaction-quality", () => ({
  validateSplits: () => mockValidateSplits(),
  detectDuplicatePairs: () => mockDetectDuplicatePairs(),
  duplicateSubjectId: (a: unknown, b: unknown) => mockDuplicateSubjectId(String(a), String(b)),
  filterReviewDecisions: (anomalies: unknown) => mockFilterReviewDecisions(anomalies as unknown[]),
}));

const mockNormalizeManualTxn = vi.fn();
vi.mock("@/lib/manual-transaction", () => ({
  normalizeManualTxn: (...a: unknown[]) => mockNormalizeManualTxn(...a),
}));

let featureEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => featureEnabled,
}));

const mockMakeImportId = vi.fn(() => "import-id");
vi.mock("@/lib/import", () => ({
  makeImportId: () => mockMakeImportId(),
}));

let serviceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { POST as annotatePost } from "@/app/api/transactions/annotate/route";
import { POST as annotateBatchPost } from "@/app/api/transactions/annotate-batch/route";
import { DELETE as duplicateDelete } from "@/app/api/transactions/duplicates/[subjectId]/route";
import { POST as manualPost, DELETE as manualDelete } from "@/app/api/transactions/manual/route";
import { GET as refundsGet } from "@/app/api/transactions/refunds/route";
import { POST as commitPost } from "@/app/api/import/commit/route";

const USER = { id: "u1" };

/** Chainable thenable supabase query. Resolves via handler(kind, callIndex). */
function q(
  handler: (kind: string, i: number) => unknown,
  index: { value: number },
) {
  let kind = "select";
  const WRITE = new Set(["delete", "insert", "update", "upsert"]);
  const o: Record<string, unknown> = {};
  for (const m of [
    "select", "eq", "neq", "in", "limit", "order", "gte", "lte",
    "delete", "insert", "update", "upsert", "maybeSingle", "single", "is",
  ]) {
    o[m] = () => {
      if (kind === "select" && WRITE.has(m)) kind = m;
      return o;
    };
  }
  (o as { then: unknown }).then = (onf: (v: unknown) => unknown) => {
    const i = index.value;
    index.value += 1;
    const v = handler(kind, i);
    return Promise.resolve(v).then(onf);
  };
  return o;
}

function supabase(handlers: Record<string, (kind: string, i: number) => unknown>) {
  const counters: Record<string, { value: number }> = {};
  return {
    from: vi.fn((table: string) => {
      counters[table] ??= { value: 0 };
      return q(handlers[table] ?? (() => ({ data: null, error: null })), counters[table]);
    }),
  };
}

function jsonRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  featureEnabled = true;
  mockCheckRateLimit.mockResolvedValue(true);
  mockValidateSplits.mockReturnValue({ valid: true, difference: 0 });
  mockMakeImportId.mockReturnValue("import-id");
  serviceClient = { from: vi.fn() };
  mockRequireUser.mockResolvedValue({ user: USER, supabase: supabase({}) });
});

describe("POST /api/transactions/annotate", () => {
  const TXN = { id: "t1", amount: 100, date: "2026-01-01" };

  function handlers(over: Record<string, (kind: string, i: number) => unknown> = {}) {
    return {
      transactions: () => ({ data: TXN, error: null }),
      goals: () => ({ data: null, error: null }),
      transaction_annotations: (kind: string) =>
        kind === "delete" ? { error: null } : { error: null },
      transaction_splits: (kind: string) =>
        kind === "delete" ? { error: null } : { error: null },
      goal_progress_events: () => ({ error: null }),
      ...over,
    };
  }

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await annotatePost({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns bad request when transaction_id is missing", async () => {
    const res = await annotatePost(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns bad request when the transaction is not owned", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: null, error: null }) }),
    });
    const res = await annotatePost(jsonRequest({ transaction_id: "t1" }));
    expect(res.status).toBe(400);
  });

  it("throws to 500 when the annotation delete errors (line 68)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          transaction_annotations: (kind) =>
            kind === "delete" ? { error: new Error("del fail") } : { error: null },
        }),
      ),
    });
    const res = await annotatePost(jsonRequest({ transaction_id: "t1" }));
    expect(res.status).toBe(500);
  });

  it("handles a non-array splits value and a successful empty delete (lines 91, 112-ok)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          transaction_splits: (kind) =>
            kind === "delete" ? { error: null } : { error: null },
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({ transaction_id: "t1", splits: "not-an-array" }),
    );
    expect(res.status).toBe(200);
  });

  it("throws to 500 when the empty-splits delete errors (line 112)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          transaction_splits: (kind) =>
            kind === "delete" ? { error: new Error("empty del fail") } : { error: null },
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({ transaction_id: "t1", splits: [] }),
    );
    expect(res.status).toBe(500);
  });

  it("maps a non-string split category to empty and saves valid splits (line 96 both sides)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(handlers()),
    });
    const res = await annotatePost(
      jsonRequest({
        transaction_id: "t1",
        splits: [
          { category: "Food", amount: 50 },
          { category: 123, amount: 10 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(mockValidateSplits).toHaveBeenCalled();
  });

  it("throws to 500 when the pre-insert split delete errors (line 133)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          transaction_splits: (kind) =>
            kind === "delete" ? { error: new Error("delete before insert") } : { error: null },
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({ transaction_id: "t1", splits: [{ category: "Food", amount: 100 }] }),
    );
    expect(res.status).toBe(500);
  });

  it("throws to 500 when inserting splits errors (line 142)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          transaction_splits: (kind) =>
            kind === "delete" ? { error: null } : { error: new Error("insert fail") },
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({ transaction_id: "t1", splits: [{ category: "Food", amount: 100 }] }),
    );
    expect(res.status).toBe(500);
  });

  it("throws to 500 when the goal stale delete errors (line 174)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          goals: () => ({ data: { id: "g1", spending_reduces: false }, error: null }),
          goal_progress_events: (kind) =>
            kind === "delete" ? { error: new Error("stale fail") } : { error: null },
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({ transaction_id: "t1", goal_id: "g1" }),
    );
    expect(res.status).toBe(500);
  });

  it("throws to 500 when the spending-reduces upsert errors (line 188)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          goals: () => ({ data: { id: "g1", spending_reduces: true }, error: null }),
          goal_progress_events: (kind) =>
            kind === "delete"
              ? { error: null }
              : { error: new Error("upsert fail") },
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({ transaction_id: "t1", goal_id: "g1" }),
    );
    expect(res.status).toBe(500);
  });

  it("throws to 500 when the else-if goal delete errors (line 196)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          goals: () => ({ data: { id: "g1", spending_reduces: false }, error: null }),
          goal_progress_events: (kind, i) =>
            kind === "delete" ? (i === 0 ? { error: null } : { error: new Error("final fail") }) : { error: null },
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({ transaction_id: "t1", goal_id: "g1" }),
    );
    expect(res.status).toBe(500);
  });

  it("returns ok on a full valid save", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase(
        handlers({
          goals: () => ({ data: { id: "g1", spending_reduces: true }, error: null }),
        }),
      ),
    });
    const res = await annotatePost(
      jsonRequest({
        transaction_id: "t1",
        note: "hello",
        tags: ["a", "b"],
        goal_id: "g1",
        splits: [{ category: "Food", amount: 100 }],
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});

describe("POST /api/transactions/annotate-batch", () => {
  function batchService(existingData: unknown, upsertError: unknown) {
    let upsertPayload: unknown;
    const from = vi.fn((table: string) => {
      if (table === "transaction_annotations") {
        let kind = "select";
        const o: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "upsert"]) {
          o[m] = (...args: unknown[]) => {
            if (kind === "select" && m === "upsert") {
              kind = m;
              upsertPayload = args[0];
            }
            return o;
          };
        }
        (o as { then: unknown }).then = (onf: (v: unknown) => unknown) =>
          Promise.resolve(
            kind === "select" ? { data: existingData, error: null } : { error: upsertError },
          ).then(onf);
        return o;
      }
      if (table === "transactions") {
        const o: Record<string, unknown> = {};
        for (const m of ["select", "in", "eq"]) o[m] = () => o;
        (o as { then: unknown }).then = (onf: (v: unknown) => unknown) =>
          Promise.resolve({ data: [{ id: "t1" }], error: null }).then(onf);
        return o;
      }
      return null as never;
    });
    return { from, getUpsertPayload: () => upsertPayload };
  }

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await annotateBatchPost({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns bad request for an invalid tag", async () => {
    const res = await annotateBatchPost(jsonRequest({ tag: "", transaction_ids: ["t1"] }));
    expect(res.status).toBe(400);
  });

  it("returns updated:0 when no owned transactions survive (line 40)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: [], error: null }) }),
    });
    const res = await annotateBatchPost(
      jsonRequest({ tag: "fun", transaction_ids: ["t9"] }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ updated: 0 });
  });

  it("merges tags over a null existing row (line 52 null side)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: [{ id: "t1" }], error: null }) }),
    });
    serviceClient = batchService(null, null) as never;
    const res = await annotateBatchPost(
      jsonRequest({ tag: "fun", transaction_ids: ["t1"] }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ updated: 1 });
    expect(
      (serviceClient as unknown as { getUpsertPayload: () => unknown }).getUpsertPayload(),
    ).toEqual([
      {
        user_id: "u1",
        transaction_id: "t1",
        note: "",
        tags: ["fun"],
      },
    ]);
  });

  it("merges tags with existing tags (line 52 array side)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: [{ id: "t1" }], error: null }) }),
    });
    serviceClient = batchService(
      [{ transaction_id: "t1", note: "n", tags: ["old"] }],
      null,
    ) as never;
    const res = await annotateBatchPost(
      jsonRequest({ tag: "fun", transaction_ids: ["t1"] }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ updated: 1 });
    expect(
      (serviceClient as unknown as { getUpsertPayload: () => unknown }).getUpsertPayload(),
    ).toEqual([
      {
        user_id: "u1",
        transaction_id: "t1",
        note: "n",
        tags: ["old", "fun"],
      },
    ]);
  });

  it("returns 500 when the service upsert errors (lines 70, 74)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: [{ id: "t1" }], error: null }) }),
    });
    serviceClient = batchService(null, new Error("upsert fail")) as never;
    const res = await annotateBatchPost(
      jsonRequest({ tag: "fun", transaction_ids: ["t1"] }),
    );
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/transactions/duplicates/[subjectId]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ subjectId: id }) });

  it("returns 401 when unauthenticated (line 12)", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await duplicateDelete({} as NextRequest, ctx("a:b"));
    expect(res.status).toBe(401);
  });

  it("returns bad request for an invalid subject id", async () => {
    const res = await duplicateDelete({} as NextRequest, ctx("nocolon"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the link is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ linked_duplicates: () => ({ data: null, error: null }) }),
    });
    const res = await duplicateDelete({} as NextRequest, ctx("a:b"));
    expect(res.status).toBe(404);
  });

  it("returns 500 when the link lookup errors (line 23)", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ linked_duplicates: () => ({ data: null, error: new Error("lookup fail") }) }),
    });
    const res = await duplicateDelete({} as NextRequest, ctx("a:b"));
    expect(res.status).toBe(500);
  });

  it("undoes the duplicate and audits", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ linked_duplicates: () => ({ data: { subject_id: "a:b" }, error: null }) }),
    });
    serviceClient = {
      rpc: vi.fn().mockResolvedValue({ error: null }),
      from: vi.fn(),
    } as never;
    const res = await duplicateDelete({} as NextRequest, ctx("a:b"));
    expect(res.status).toBe(200);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "duplicate_undone" }),
    );
  });

  it("returns 500 when the rpc errors", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ linked_duplicates: () => ({ data: { subject_id: "a:b" }, error: null }) }),
    });
    serviceClient = {
      rpc: vi.fn().mockResolvedValue({ error: new Error("rpc fail") }),
      from: vi.fn(),
    } as never;
    const res = await duplicateDelete({} as NextRequest, ctx("a:b"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/transactions/manual", () => {
  const plaidValue = {
    ok: true,
    value: {
      kind: "debit",
      amount: 10,
      merchant: "Store",
      date: "2026-01-01",
      account: { source: "plaid", id: "a1" },
      category: "Food",
      goalId: null,
      notes: null,
      signedAmount: 10,
    },
  };

  it("returns 404 when the feature is off", async () => {
    featureEnabled = false;
    const res = await manualPost(jsonRequest({}));
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await manualPost(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns bad request when normalize fails", async () => {
    mockNormalizeManualTxn.mockReturnValue({ ok: false, error: "bad input" });
    const res = await manualPost(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the account is not found", async () => {
    mockNormalizeManualTxn.mockReturnValue(plaidValue);
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ accounts: () => ({ data: null, error: null }) }),
    });
    const res = await manualPost(jsonRequest({}));
    expect(res.status).toBe(404);
  });

  it("creates a plaid-source transaction (line 48 plaid, line 49 null)", async () => {
    mockNormalizeManualTxn.mockReturnValue(plaidValue);
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "txn1" }, error: null }),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ accounts: () => ({ data: { id: "a1" }, error: null }) }),
    });
    serviceClient = { from: vi.fn(() => insertChain) } as never;
    const res = await manualPost(jsonRequest({}));
    expect(res.status).toBe(201);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: "a1", manual_account_id: null }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_transaction_created" }),
    );
  });

  it("creates a manual-source transaction (line 48 null, line 49 manual)", async () => {
    mockNormalizeManualTxn.mockReturnValue({
      ...plaidValue,
      value: {
        ...plaidValue.value,
        account: { source: "manual", id: "ma1" },
      },
    });
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "txn2" }, error: null }),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ manual_accounts: () => ({ data: { id: "ma1" }, error: null }) }),
    });
    serviceClient = { from: vi.fn(() => insertChain) } as never;
    const res = await manualPost(jsonRequest({}));
    expect(res.status).toBe(201);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: null, manual_account_id: "ma1" }),
    );
  });

  it("returns 500 when the service insert errors (line 61)", async () => {
    mockNormalizeManualTxn.mockReturnValue(plaidValue);
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error("insert fail") }),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ accounts: () => ({ data: { id: "a1" }, error: null }) }),
    });
    serviceClient = { from: vi.fn(() => insertChain) } as never;
    const res = await manualPost(jsonRequest({}));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/transactions/manual", () => {
  it("returns 404 when the feature is off", async () => {
    featureEnabled = false;
    const res = await manualDelete(jsonRequest({ id: "t1" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the transaction is not manual", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: { id: "t1", source: "plaid" }, error: null }) }),
    });
    const res = await manualDelete(jsonRequest({ id: "t1" }));
    expect(res.status).toBe(404);
  });

  it("deletes a manual transaction and audits", async () => {
    const deleteChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: { id: "t1", source: "manual" }, error: null }) }),
    });
    serviceClient = {
      from: vi.fn(() => deleteChain),
    } as never;
    const res = await manualDelete(jsonRequest({ id: "t1" }));
    expect(res.status).toBe(200);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_transaction_deleted" }),
    );
  });

  it("returns 500 when the service delete errors (line 118)", async () => {
    const deleteChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: new Error("delete fail") }),
      }),
    };
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ transactions: () => ({ data: { id: "t1", source: "manual" }, error: null }) }),
    });
    serviceClient = { from: vi.fn(() => deleteChain) } as never;
    const res = await manualDelete(jsonRequest({ id: "t1" }));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/transactions/refunds", () => {
  it("returns 500 when the rate limit check rejects (line 83)", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("rate fail"));
    const res = await refundsGet();
    expect(res.status).toBe(500);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await refundsGet();
    expect(res.status).toBe(429);
  });
});

describe("POST /api/import/commit", () => {
  function svc(over: Record<string, (kind: string, i: number) => unknown> = {}) {
    const counters: Record<string, { value: number }> = {};
    const handlers: Record<string, (kind: string, i: number) => unknown> = {
      transactions: (kind) => (kind === "upsert" ? { error: null } : { error: null }),
      import_review_rows: (kind) =>
        kind === "update" ? { error: null } : { data: null, error: null },
      import_review_batches: (kind) =>
        kind === "update" ? { error: null } : { data: null, error: null },
      ...over,
    };
    return {
      from: vi.fn((table: string) => {
        counters[table] ??= { value: 0 };
        return q(handlers[table] ?? (() => ({ data: null, error: null })), counters[table]);
      }),
    };
  }

  function authSupabase(rows: unknown) {
    return supabase({
      accounts: () => ({ data: { id: "a1" }, error: null }),
      import_review_rows: () => ({ data: rows, error: null }),
    });
  }

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await commitPost(jsonRequest({ batch_id: "b", account_id: "a" }));
    expect(res.status).toBe(401);
  });

  it("returns bad request when ids are missing", async () => {
    const res = await commitPost(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the account is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: supabase({ accounts: () => ({ data: null, error: null }) }),
    });
    const res = await commitPost(jsonRequest({ batch_id: "b", account_id: "a" }));
    expect(res.status).toBe(404);
  });

  it("commits with null rows (lines 39, 76 null side)", async () => {
    serviceClient = svc();
    mockRequireUser.mockResolvedValue({ user: USER, supabase: authSupabase(null) });
    const res = await commitPost(jsonRequest({ batch_id: "b", account_id: "a" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 0 });
  });

  it("commits rows and updates review rows/batch (lines 39, 76 array side)", async () => {
    serviceClient = svc();
    mockRequireUser.mockResolvedValue({
      user: USER,
      supabase: authSupabase([
        { id: "r1", date: "2026-01-01", description: "Store", amount: 10, category: "Food", status: "pending" },
      ]),
    });
    const res = await commitPost(
      jsonRequest({ batch_id: "b", account_id: "a", approved_row_ids: ["r1"] }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 1 });
    expect(mockMakeImportId).toHaveBeenCalled();
  });

  it("returns 500 when the transactions upsert errors (line 73)", async () => {
    serviceClient = svc({
      transactions: (kind) => (kind === "upsert" ? { error: new Error("upsert fail") } : { error: null }),
    });
    mockRequireUser.mockResolvedValue({ user: USER, supabase: authSupabase([{ id: "r1", date: "2026-01-01", description: "Store", amount: 10, category: "Food", status: "pending" }]) });
    const res = await commitPost(jsonRequest({ batch_id: "b", account_id: "a" }));
    expect(res.status).toBe(500);
  });

  it("returns 500 when the review rows update errors (line 83)", async () => {
    serviceClient = svc({
      import_review_rows: (kind) =>
        kind === "update" ? { error: new Error("rows update fail") } : { data: null, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: USER, supabase: authSupabase([{ id: "r1", status: "pending" }]) });
    const res = await commitPost(jsonRequest({ batch_id: "b", account_id: "a" }));
    expect(res.status).toBe(500);
  });

  it("returns 500 when the batch update errors (line 90)", async () => {
    serviceClient = svc({
      import_review_batches: (kind) =>
        kind === "update" ? { error: new Error("batch update fail") } : { data: null, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: USER, supabase: authSupabase([{ id: "r1", status: "pending" }]) });
    const res = await commitPost(jsonRequest({ batch_id: "b", account_id: "a" }));
    expect(res.status).toBe(500);
  });
});
