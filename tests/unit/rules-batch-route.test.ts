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

vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

describe("POST /api/rules/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if unauthenticated", async () => {
    mockRequireUser.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const req = new NextRequest("http://localhost/api/rules/batch", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: {},
    });

    const req = new NextRequest("http://localhost/api/rules/batch", {
      method: "POST",
      body: "not-json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns dry run preview when dryRun is true", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "merchant_rules") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "r1",
                  match_type: "keyword",
                  pattern: "Target",
                  display_name: "Target Store",
                  category: "SHOPPING",
                  enabled: true,
                },
              ],
            }),
          };
        }
        if (table === "transactions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "tx-1",
                  merchant: "Target #123",
                  name: "TARGET",
                  amount: -40,
                  pfc_primary: "GENERAL",
                },
              ],
            }),
          };
        }
        if (table === "transaction_annotations") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [] }),
          };
        }
        return {};
      }),
    };

    mockRequireUser.mockResolvedValueOnce({
      user: { id: "u-1" },
      supabase: mockSupabase,
    });

    const req = new NextRequest("http://localhost/api/rules/batch", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.totalEvaluated).toBe(1);
    expect(body.matchedCount).toBe(1);
    expect(body.modifiedCount).toBe(1);
    expect(body.preview[0].updated.merchant).toBe("Target Store");
  });
});
