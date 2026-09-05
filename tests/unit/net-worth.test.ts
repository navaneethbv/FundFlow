import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSingle = vi.fn().mockResolvedValue({ data: { id: "snap-1" }, error: null });
const mockSelect = vi.fn(() => ({ single: mockSingle }));
const mockUpsert = vi.fn(() => ({ select: mockSelect }));
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: mockFrom,
  }),
}));

import { writeNetWorthSnapshot } from "@/lib/net-worth";

describe("writeNetWorthSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes net worth and writes snapshot with active and excluded accounts", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  { id: "a1", name: "Checking", type: "depository", subtype: "checking", current_balance: 1000 },
                  { id: "a2", name: "Excluded Plaid", type: "depository", subtype: "checking", current_balance: 500 },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === "manual_accounts") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  { id: "m1", name: "Cash", account_type: "cash", balance: 200, include_in_net_worth: true },
                  { id: "m2", name: "Excluded Manual", account_type: "cash", balance: 100, include_in_net_worth: false },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    dashboard_prefs: {
                      accountsPage: {
                        excludedNetWorthIds: ["a2"],
                      },
                    },
                  },
                }),
            }),
          }),
        };
      }
      if (table === "net_worth_snapshots") {
        return {
          upsert: mockUpsert,
        };
      }
      return {};
    });

    const result = await writeNetWorthSnapshot("u1");
    expect(result).toBeDefined();
    expect(mockUpsert).toHaveBeenCalled();
  });

  it("throws when accounts query errors", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: null, error: new Error("Plaid accounts error") }),
          }),
        };
      }
      return {};
    });

    await expect(writeNetWorthSnapshot("u1")).rejects.toThrow("Plaid accounts error");
  });

  it("throws when manual accounts query errors", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "manual_accounts") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: null, error: new Error("Manual accounts error") }),
          }),
        };
      }
      return {};
    });

    await expect(writeNetWorthSnapshot("u1")).rejects.toThrow("Manual accounts error");
  });

  it("throws when upserting snapshot errors", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "manual_accounts") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null }),
            }),
          }),
        };
      }
      if (table === "net_worth_snapshots") {
        return {
          upsert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: new Error("Upsert snapshot error") }),
            }),
          }),
        };
      }
      return {};
    });

    await expect(writeNetWorthSnapshot("u1")).rejects.toThrow("Upsert snapshot error");
  });
});
