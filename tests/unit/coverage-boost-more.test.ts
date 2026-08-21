import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as importCommitPost } from "@/app/api/import/commit/route";
import { detectCardDesign } from "@/lib/card-design";
import * as http from "@/lib/http";

describe("Coverage Boost More Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Import Commit Route Branches", () => {
    it("handles unauthorized calls", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
      });
      expect((await importCommitPost(req)).status).toBe(401);
    });

    it("rejects missing batch_id or account_id", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: {} as never,
      });
      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "b-1" }),
      });
      expect((await importCommitPost(req)).status).toBe(400);
    });

    it("handles account not found", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      } as never;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: mockSupabase,
      });

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({ batch_id: "b-1", account_id: "acc-404" }),
      });
      expect((await importCommitPost(req)).status).toBe(404);
    });

    it("commits pending review rows successfully with approved_row_ids", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "accounts") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "acc-1" }, error: null }),
                }),
              }),
            };
          }
          if (table === "import_review_rows") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    in: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "row-1",
                          date: "2026-08-01",
                          description: "Starbucks",
                          amount: 5.5,
                          category: "Coffee & Dining",
                          status: "pending",
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      } as never;

      const service = await import("@/lib/supabase/service");
      vi.spyOn(service, "createServiceClient").mockReturnValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "transactions") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === "import_review_rows") {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            };
          }
          if (table === "import_review_batches") {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      } as never);

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "u-1" } as never,
        supabase: mockSupabase,
      });

      const req = new NextRequest("http://localhost/api/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batch_id: "b-1",
          account_id: "acc-1",
          approved_row_ids: ["row-1"],
        }),
      });
      const res = await importCommitPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.imported).toBe(1);
    });
  });

  describe("Card Design Detection Branches", () => {
    it("detects all premium card designs and networks", () => {
      // Depository
      const checking = detectCardDesign("My Checking", undefined, "depository", "checking");
      expect(checking.displayName).toBe("My Checking");

      // Goldman Sachs (not Amex Gold)
      const goldman = detectCardDesign("Goldman Sachs", undefined, "credit", undefined);
      expect(goldman.displayName).not.toBe("Amex Gold");

      // Amex Gold
      const amexGold = detectCardDesign("Gold Card", undefined, "credit", undefined);
      expect(amexGold.displayName).toBe("Amex Gold");

      // Amex Platinum
      const amexPlat = detectCardDesign("Platinum Card", undefined, "credit", undefined);
      expect(amexPlat.displayName).toBe("Amex Platinum");

      // Sapphire Reserve
      const reserve = detectCardDesign("Reserve Card", undefined, "credit", undefined);
      expect(reserve.displayName).toBe("Sapphire Reserve");

      // Sapphire Preferred
      const preferred = detectCardDesign("Sapphire Card", undefined, "credit", undefined);
      expect(preferred.displayName).toBe("Sapphire Preferred");

      // Chase Freedom
      const freedom = detectCardDesign("Freedom Flex", undefined, "credit", undefined);
      expect(freedom.displayName).toBe("Chase Freedom");

      // Apple Card
      const apple = detectCardDesign("Apple Card", undefined, "credit", undefined);
      expect(apple.displayName).toBe("Apple Card");

      // Capital One Venture
      const venture = detectCardDesign("Venture X", undefined, "credit", undefined);
      expect(venture.displayName).toBe("Capital One Venture");

      // Visa fallback
      const visa = detectCardDesign("Visa Signature", undefined, "credit", undefined);
      expect(visa.network).toBe("visa");

      // Mastercard fallback (MC)
      const mc = detectCardDesign("MC World Elite", undefined, "credit", undefined);
      expect(mc.network).toBe("mastercard");

      // Discover
      const discover = detectCardDesign("Discover It", undefined, "credit", undefined);
      expect(discover.network).toBe("discover");

      // Blue Cash (Amex)
      const blueCash = detectCardDesign("Blue Cash Everyday", undefined, "credit", undefined);
      expect(blueCash.network).toBe("amex");

      // Generic Credit Card
      const generic = detectCardDesign(undefined, undefined, "credit", undefined);
      expect(generic.displayName).toBe("Credit Card");
    });
  });
});
