import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rules/batch/route";
import { NextRequest } from "next/server";

const mockRequireUser = vi.fn();
const mockWriteAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status: 400 }),
  errorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

const mockServiceUpdate = vi.fn();
const mockServiceIn = vi.fn();
const mockServiceEq = vi.fn().mockResolvedValue({ error: null });

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
  onUpsert?: (...args: unknown[]) => Promise<{ error: null }>;
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
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: transactions }),
        };
      }
      if (table === "transaction_annotations") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [] }),
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
});
