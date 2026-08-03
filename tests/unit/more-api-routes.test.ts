import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn();
const mockCheckRateLimit = vi.fn().mockResolvedValue(true);
const serviceDb = clientStub({
  accounts: { data: [] },
  recurring_streams: { data: { id: "00000000-0000-0000-0000-000000000001" } },
});

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return {
    ...actual,
    requireUser: () => mockRequireUser(),
  };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string, limit: number, window: number) =>
    mockCheckRateLimit(key, limit, window),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceDb,
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  getClientIp: () => "127.0.0.1",
}));

import { POST as importCommitPost } from "@/app/api/import/commit/route";
import { PATCH as recurringPatch } from "@/app/api/recurring/route";
import { POST as cancelledPost } from "@/app/api/subscriptions/cancelled/route";

describe("More API Routes Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/import/commit", () => {
    it("returns 400 when missing required body fields", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await importCommitPost(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 when batch does not exist", async () => {
      const db = clientStub({
        import_review_batches: { data: null },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "batch-1", account_id: "acc-1" }),
      });
      const res = await importCommitPost(req);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/recurring", () => {
    it("updates recurring stream status", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new Request("http://localhost/api/recurring", {
        method: "PATCH",
        body: JSON.stringify({
          stream_id: "00000000-0000-0000-0000-000000000001",
          action: "review",
        }),
      });
      const res = await recurringPatch(req);
      expect(res.status).toBe(200);
    });

    it("returns 400 when stream_id is invalid", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new Request("http://localhost/api/recurring", {
        method: "PATCH",
        body: JSON.stringify({
          stream_id: "invalid-uuid",
          action: "review",
        }),
      });
      const res = await recurringPatch(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/subscriptions/cancelled", () => {
    it("returns 400 when merchant is missing", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: clientStub(),
      });
      const req = new NextRequest("http://localhost/api/subscriptions/cancelled", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await cancelledPost(req);
      expect(res.status).toBe(400);
    });

    it("marks subscription as cancelled", async () => {
      const db = clientStub({
        cancelled_subscriptions: { data: { id: "c1", merchant: "Gym" } },
      });
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1" },
        supabase: db,
      });
      const req = new NextRequest("http://localhost/api/subscriptions/cancelled", {
        method: "POST",
        body: JSON.stringify({ merchant: "Gym" }),
      });
      const res = await cancelledPost(req);
      expect(res.status).toBe(200);
    });
  });
});
