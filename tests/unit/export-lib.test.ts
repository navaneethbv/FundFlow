import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPrivacySafeRows, isExportAllowed } from "@/lib/export";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("lib/export", () => {
  let mockSupabase: Partial<SupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isExportAllowed", () => {
    it("returns true when ai_export_enabled is true", async () => {
      const single = vi.fn().mockResolvedValue({ data: { ai_export_enabled: true } });
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq });
      mockSupabase = { from: vi.fn().mockReturnValue({ select }) };

      const allowed = await isExportAllowed(mockSupabase as SupabaseClient, "user-1");
      expect(allowed).toBe(true);
    });

    it("returns false when ai_export_enabled is false", async () => {
      const single = vi.fn().mockResolvedValue({ data: { ai_export_enabled: false } });
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq });
      mockSupabase = { from: vi.fn().mockReturnValue({ select }) };

      const allowed = await isExportAllowed(mockSupabase as SupabaseClient, "user-1");
      expect(allowed).toBe(false);
    });

    it("returns true when profile is missing or null", async () => {
      const single = vi.fn().mockResolvedValue({ data: null });
      const eq = vi.fn().mockReturnValue({ single });
      const select = vi.fn().mockReturnValue({ eq });
      mockSupabase = { from: vi.fn().mockReturnValue({ select }) };

      const allowed = await isExportAllowed(mockSupabase as SupabaseClient, "user-1");
      expect(allowed).toBe(true);
    });
  });

  describe("fetchPrivacySafeRows", () => {
    it("returns allowed: false when profile has ai_export_enabled: false", async () => {
      const singleProfile = vi.fn().mockResolvedValue({
        data: { ai_export_enabled: false },
      });
      const eqProfile = vi.fn().mockReturnValue({ single: singleProfile });
      const selectProfile = vi.fn().mockReturnValue({ eq: eqProfile });

      mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") return { select: selectProfile };
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const result = await fetchPrivacySafeRows(
        mockSupabase as SupabaseClient,
        "user-1",
      );
      expect(result).toEqual({ allowed: false });
    });

    it("returns privacy-safe rows when export is allowed", async () => {
      const singleProfile = vi.fn().mockResolvedValue({
        data: { ai_export_enabled: true },
      });
      const eqProfile = vi.fn().mockReturnValue({ single: singleProfile });
      const selectProfile = vi.fn().mockReturnValue({ eq: eqProfile });

      const txnsData = [
        {
          date: "2026-07-01",
          merchant_name: "Coffee Shop",
          name: "Raw Description",
          amount: 4.5,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_COFFEE_SHOP",
        },
        {
          date: "2026-07-02",
          merchant_name: null,
          name: "Gas Station",
          amount: 35.0,
          pfc_primary: "TRANSPORTATION",
          pfc_detailed: null,
        },
      ];

      const orderTxns = vi.fn().mockResolvedValue({ data: txnsData, error: null });
      const eqTxns = vi.fn().mockReturnValue({ order: orderTxns });
      const selectTxns = vi.fn().mockReturnValue({ eq: eqTxns });

      mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") return { select: selectProfile };
          if (table === "transactions") return { select: selectTxns };
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const result = await fetchPrivacySafeRows(
        mockSupabase as SupabaseClient,
        "user-1",
      );
      expect(result).toEqual({
        allowed: true,
        rows: [
          {
            date: "2026-07-01",
            merchant: "Coffee Shop",
            amount: 4.5,
            category: "FOOD_AND_DRINK_COFFEE_SHOP",
          },
          {
            date: "2026-07-02",
            merchant: "Gas Station",
            amount: 35.0,
            category: "TRANSPORTATION",
          },
        ],
      });
    });

    it("throws error when transaction query fails", async () => {
      const singleProfile = vi.fn().mockResolvedValue({
        data: { ai_export_enabled: true },
      });
      const eqProfile = vi.fn().mockReturnValue({ single: singleProfile });
      const selectProfile = vi.fn().mockReturnValue({ eq: eqProfile });

      const orderTxns = vi
        .fn()
        .mockResolvedValue({ data: null, error: new Error("DB Error") });
      const eqTxns = vi.fn().mockReturnValue({ order: orderTxns });
      const selectTxns = vi.fn().mockReturnValue({ eq: eqTxns });

      mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") return { select: selectProfile };
          if (table === "transactions") return { select: selectTxns };
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      await expect(
        fetchPrivacySafeRows(mockSupabase as SupabaseClient, "user-1"),
      ).rejects.toThrow("DB Error");
    });
  });
});
