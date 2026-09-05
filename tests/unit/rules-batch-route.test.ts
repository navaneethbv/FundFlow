import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rules/batch/route";
import { NextRequest } from "next/server";

const mockRequireUser = vi.fn();
const mockWriteAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status: 400 }),
  errorResponse: (context: string, error: unknown, status = 500) =>
    new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : typeof error === "object" && error !== null && "message" in error
              ? (error as { message: string }).message
              : String(error),
      }),
      { status: typeof status === "number" ? status : 500 },
    ),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

const mockServiceUpdate = vi.fn();
const mockServiceIn = vi.fn();
const mockServiceEq = vi.fn().mockResolvedValue({ error: null });
const mockTransactionSelect = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      update: (...args: unknown[]) => {
        mockServiceUpdate(...args);
        return {
          in: (...inArgs: unknown[]) => {
            mockServiceIn(...inArgs);
            return {
              eq: (...eqArgs: unknown[]) => mockServiceEq(...eqArgs),
            };
          },
        };
      },
    }),
  }),
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

function createMockBatchDb(options?: {
  rules?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
  annotations?: Array<Record<string, unknown>>;
  onUpsert?: (...args: unknown[]) => Promise<{ error: unknown }>;
}) {
  const {
    rules = [
      {
        id: "r1",
        match_type: "keyword",
        pattern: "Target",
        display_name: "Target Store",
        category: "SHOPPING",
        enabled: true,
      },
    ],
    transactions = [
      {
        id: "tx-1",
        merchant: "Target #123",
        name: "TARGET",
        amount: -40,
        pfc_primary: "GENERAL",
      },
    ],
    annotations = [],
    onUpsert = vi.fn().mockResolvedValue({ error: null }),
  } = options ?? {};

  return {
    from: vi.fn((table: string) => {
      if (table === "merchant_rules") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: rules }),
        };
      }
      if (table === "transactions") {
        return {
          select: (...args: unknown[]) => {
            mockTransactionSelect(...args);
            return {
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: transactions }),
            };
          },
        };
      }
      if (table === "transaction_annotations") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: annotations }),
          upsert: onUpsert,
        };
      }
      return {};
    }),
  };
}

function createBatchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/rules/batch", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/rules/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps rule previews responsive on repetitive bank descriptions", async () => {
    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: createMockBatchDb({
        rules: [{ id: "r", match_type: "regex", pattern: ".*a.*a.*!", enabled: true }],
        transactions: [{ id: "tx", merchant_name: "a".repeat(300), amount: 10 }],
      }),
    });
    const started = performance.now();
    const response = await POST(createBatchRequest({ dryRun: true }));
    expect(response.status).toBe(200);
    expect((await response.json()).matchedCount).toBe(0);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("returns 401 if unauthenticated", async () => {
    mockRequireUser.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const res = await POST(createBatchRequest({ dryRun: true }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: {},
    });

    const res = await POST(createBatchRequest("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns dry run preview when dryRun is true", async () => {
    const mockSupabase = createMockBatchDb();

    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: mockSupabase,
    });

    const res = await POST(createBatchRequest({ dryRun: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.totalEvaluated).toBe(1);
    expect(body.matchedCount).toBe(1);
    expect(body.modifiedCount).toBe(1);
    expect(body.preview[0].updated.merchant).toBe("Target Store");
    expect(mockTransactionSelect).toHaveBeenCalledWith(
      "id, merchant_name, name, amount, pfc_primary",
    );
  });

  it("performs live apply with bulk upsert of annotations and merchant updates", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = createMockBatchDb({
      rules: [
        {
          id: "r1",
          match_type: "keyword",
          pattern: "Target",
          display_name: "Target Supercenter",
          category: "GROCERIES",
          enabled: true,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          merchant: "Target Store",
          name: "TARGET",
          amount: -50,
          pfc_primary: "GENERAL",
        },
      ],
      onUpsert: mockUpsert,
    });

    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: mockSupabase,
    });

    const res = await POST(
      createBatchRequest({
        dryRun: false,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(false);
    expect(body.appliedCount).toBeGreaterThan(0);

    // Verify bulk upsert into transaction_annotations with display_category and tags
    expect(mockUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          transaction_id: "tx-1",
          display_category: "GROCERIES",
          tags: [],
        }),
      ],
      { onConflict: "user_id,transaction_id" },
    );

    // Verify service client update for merchant renaming
    expect(mockServiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ merchant_name: "Target Supercenter" }),
    );
    expect(mockServiceIn).toHaveBeenCalledWith("id", ["tx-1"]);
  });

  it("propagates annotation write failure and records audit trail with failed_table", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: { message: "upsert failed" } });
    const mockSupabase = createMockBatchDb({
      rules: [
        {
          id: "r1",
          match_type: "keyword",
          pattern: "Target",
          display_name: "Target Supercenter",
          category: "GROCERIES",
          enabled: true,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          merchant: "Target Store",
          name: "TARGET",
          amount: -50,
          pfc_primary: "GENERAL",
        },
      ],
      onUpsert: mockUpsert,
    });

    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: mockSupabase,
    });

    const res = await POST(createBatchRequest({ dryRun: false }));
    expect(res.status).toBe(500);

    // Should log attempt first, then failure result with failed_table
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rules_batch_applied",
        metadata: expect.objectContaining({ phase: "attempt" }),
      }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rules_batch_applied",
        metadata: expect.objectContaining({
          phase: "result",
          failed_table: "transaction_annotations",
        }),
      }),
    );
  });

  it("propagates merchant update failure and records audit trail with failed_table", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockServiceEq.mockResolvedValueOnce({ error: { message: "merchant update failed" } });

    const mockSupabase = createMockBatchDb({
      rules: [
        {
          id: "r1",
          match_type: "keyword",
          pattern: "Target",
          display_name: "Target Supercenter",
          category: "GROCERIES",
          enabled: true,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          merchant: "Target Store",
          name: "TARGET",
          amount: -50,
          pfc_primary: "GENERAL",
        },
      ],
      onUpsert: mockUpsert,
    });

    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: mockSupabase,
    });

    const res = await POST(createBatchRequest({ dryRun: false }));
    expect(res.status).toBe(500);

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rules_batch_applied",
        metadata: expect.objectContaining({ phase: "attempt" }),
      }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rules_batch_applied",
        metadata: expect.objectContaining({
          phase: "result",
          failed_table: "transactions",
        }),
      }),
    );
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: {},
    });
    const res = await POST(createBatchRequest({ dryRun: false }));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe("Too many requests");
  });

  it("does not rewrite annotations or inflate appliedCount for transactions with unchanged tags and category", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = createMockBatchDb({
      rules: [
        {
          id: "r1",
          match_type: "keyword",
          pattern: "Target",
          display_name: "Target Store", // Merchant change only!
          enabled: true,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          merchant: "Target",
          name: "TARGET",
          amount: -50,
          pfc_primary: "GENERAL",
        },
      ],
      annotations: [
        {
          transaction_id: "tx-1",
          tags: ["existing-tag"],
          display_category: null,
        },
      ],
      onUpsert: mockUpsert,
    });

    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: mockSupabase,
    });

    const res = await POST(createBatchRequest({ dryRun: false }));
    expect(res.status).toBe(200);
    // Annotation upsert should NOT have been called because category and tags didn't change!
    expect(mockUpsert).not.toHaveBeenCalled();
    const data = await res.json();
    expect(data.appliedCount).toBe(1); // 1 merchant update, 0 annotation rewrites
  });
});

