import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSupabase = {
  from: vi.fn(),
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockSupabase,
}));

import { writeNetWorthSnapshot } from "@/lib/net-worth";

describe("writeNetWorthSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gathers plaid and manual accounts, computes snapshot, and upserts it", async () => {
    const plaidChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          { name: "Checking", type: "depository", current_balance: 1000 },
          { name: "Credit Card", type: "credit", current_balance: 200 },
        ],
      }),
    };

    const manualChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          {
            name: "Cash",
            account_type: "depository",
            balance: 50,
            include_in_net_worth: true,
          },
          {
            name: "Exclude",
            account_type: "depository",
            balance: 500,
            include_in_net_worth: false,
          },
          {
            name: "NullBalance",
            account_type: "depository",
            balance: null,
            include_in_net_worth: true,
          },
        ],
      }),
    };

    const upsertChain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "snapshot-1" },
        error: null,
      }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "accounts") return plaidChain;
      if (table === "manual_accounts") return manualChain;
      if (table === "net_worth_snapshots") return upsertChain;
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await writeNetWorthSnapshot("user-1");
    expect(res).toEqual({ id: "snapshot-1" });

    expect(plaidChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(manualChain.eq).toHaveBeenCalledWith("user_id", "user-1");

    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        assets: expect.any(Number),
        liabilities: expect.any(Number),
      }),
      { onConflict: "user_id,snapshot_month" },
    );
  });

  it("handles null return values from supabase calls safely", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null }),
        upsert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: "empty-snapshot" },
          error: null,
        }),
      };
      return chain;
    });

    const res = await writeNetWorthSnapshot("user-2");
    expect(res).toEqual({ id: "empty-snapshot" });
  });

  it("throws error if upsert query returns an error", async () => {
    const errorChain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("DB Error"),
      }),
    };

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "net_worth_snapshots") return errorChain;
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [] }),
      };
    });

    await expect(writeNetWorthSnapshot("user-3")).rejects.toThrow("DB Error");
  });
});
