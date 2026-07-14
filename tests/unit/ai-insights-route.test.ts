import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockErrorResponse = vi.fn();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockFetchPrivacySafeRows = vi.fn();
vi.mock("@/lib/export", () => ({
  fetchPrivacySafeRows: (...args: unknown[]) =>
    mockFetchPrivacySafeRows(...args),
}));

const mockGenerateAiInsightSummaries = vi.fn();
vi.mock("@/lib/ai-insights", () => ({
  generateAiInsightSummaries: (...args: unknown[]) =>
    mockGenerateAiInsightSummaries(...args),
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

import { POST } from "@/app/api/ai/insights/route";
import { NextResponse } from "next/server";

describe("POST /api/ai/insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early if requireUser fails", async () => {
    const errorResponseObject = new NextResponse("unauthorized", { status: 401 });
    mockRequireUser.mockResolvedValue(errorResponseObject);

    const res = await POST();
    expect(res).toBe(errorResponseObject);
  });

  it("returns empty insights if AI settings not enabled or export is not allowed", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { enabled: false } }),
            }),
          }),
        }),
      },
    });
    mockFetchPrivacySafeRows.mockResolvedValue({ allowed: false, rows: [] });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ insights: [] });
  });

  it("generates and saves insights when enabled and allowed", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { enabled: true } }),
            }),
          }),
        }),
      },
    });
    mockFetchPrivacySafeRows.mockResolvedValue({
      allowed: true,
      rows: [
        {
          date: "2026-06-15",
          merchant: "Store",
          category: "Food",
          amount: 20,
        },
      ],
    });

    const mockInsights = [
      {
        insightType: "budget",
        summary: "Over budget",
        sourceMonth: "2026-06",
      },
    ];
    mockGenerateAiInsightSummaries.mockReturnValue(mockInsights);

    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockReturnValue({
      insert: insertMock,
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ insights: mockInsights });

    expect(insertMock).toHaveBeenCalledWith([
      {
        user_id: "u1",
        insight_type: "budget",
        summary: "Over budget",
        source_month: "2026-06-01",
      },
    ]);
  });

  it("handles db insertion error by calling errorResponse", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { enabled: true } }),
            }),
          }),
        }),
      },
    });
    mockFetchPrivacySafeRows.mockResolvedValue({ allowed: true, rows: [] });
    mockGenerateAiInsightSummaries.mockReturnValue([]);
    mockServiceClient.from.mockReturnValue({
      insert: () => Promise.resolve({ error: new Error("Insert failed") }),
    });
    mockErrorResponse.mockReturnValue(new Response("error", { status: 500 }));

    const res = await POST();
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith(
      "ai.insights",
      expect.any(Error),
    );
  });
});
