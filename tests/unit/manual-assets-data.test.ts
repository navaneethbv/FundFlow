import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadManualAssets, materializeManualAssets } from "@/lib/manual-assets-data";
import { manualAssetsEnabled, manualBalanceTable } from "@/lib/manual-asset-flags";
let result: { data: unknown[] | null; error: unknown };
const rpc = vi.fn();
const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn(async () => result) };
const client = { from: vi.fn(() => query), rpc } as unknown as SupabaseClient;
beforeEach(() => { result = { data: [], error: null }; rpc.mockReset().mockResolvedValue({ error: null }); vi.unstubAllEnvs(); });
it("requires all three flags to expose owned balances", () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "typedManualAssets,assetOwnership"); expect(manualAssetsEnabled()).toBe(false);
  expect(manualBalanceTable()).toBe("manual_accounts");
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "typedManualAssets,assetOwnership,historyProvenance"); expect(manualAssetsEnabled()).toBe(true);
  expect(manualBalanceTable()).toBe("manual_account_balances");
});
it("materializes each owner asset and returns ids excluded from raw snapshot writes", async () => {
  result.data = [{ manual_account_id: "a" }, { manual_account_id: "b" }];
  expect(await materializeManualAssets(client, "owner", "2026-10-02")).toEqual(new Set(["a", "b"]));
  expect(rpc).toHaveBeenCalledWith("materialize_manual_asset", { p_user_id: "owner", p_account_id: "b", p_today: "2026-10-02" });
  expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
});
it("propagates read/write failures and refuses truncated lists", async () => {
  result.error = new Error("read failed");
  await expect(materializeManualAssets(client, "u", "2026-01-01")).rejects.toThrow("read failed");
  await expect(loadManualAssets(client, "u")).rejects.toThrow("read failed");
  result = { data: Array(101).fill({ manual_account_id: "a" }), error: null };
  await expect(materializeManualAssets(client, "u", "2026-01-01")).rejects.toThrow("Too many");
  await expect(loadManualAssets(client, "u")).rejects.toThrow("Too many");
  result.data = [{ manual_account_id: "a" }]; rpc.mockResolvedValue({ error: new Error("write failed") });
  await expect(materializeManualAssets(client, "u", "2026-01-01")).rejects.toThrow("write failed");
});
it("bounds independent asset writes to four and completes later batches", async () => {
  result.data = Array.from({ length: 9 }, (_, index) => ({ manual_account_id: `asset-${index}` }));
  let active = 0;
  let peak = 0;
  rpc.mockImplementation(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return { error: null };
  });
  expect((await materializeManualAssets(client, "owner", "2026-10-02")).size).toBe(9);
  expect(peak).toBe(4);
  expect(active).toBe(0);
  expect(rpc).toHaveBeenCalledTimes(9);
});
it("does not start another batch after a write failure", async () => {
  result.data = Array.from({ length: 5 }, (_, index) => ({ manual_account_id: `asset-${index}` }));
  rpc.mockResolvedValue({ error: new Error("write failed") });
  await expect(materializeManualAssets(client, "owner", "2026-10-02")).rejects.toThrow("write failed");
  expect(rpc).toHaveBeenCalledTimes(4);
});
it("loads stored input without mistaking owned estimates for gross input", async () => {
  const row = { manual_account_id: "a", version: 1, manual_accounts: { name: "House" }, valuation_value: "100000", asset_kind: "property",
    ownership_percentage: "50", value_source: "Appraisal", valuation_date: "2026-01-01", purchase_price: null, purchase_date: null,
    growth_kind: null };
  result.data = [row];
  expect(await loadManualAssets(client, "u")).toMatchObject([{ value: 100000, ownershipPercentage: 50, growth: null, purchasePrice: null }]);
  result.data = [{ ...row, purchase_price: "90000", growth_kind: "percent", growth_amount: "3", growth_period: "year", growth_start_date: null }];
  expect(await loadManualAssets(client, "u")).toMatchObject([{ purchasePrice: 90000, growth: { amount: 3, period: "year" } }]);
  result.data = null;
  expect(await loadManualAssets(client, "u")).toEqual([]);
  expect(await materializeManualAssets(client, "u", "2026-01-01")).toEqual(new Set());
});
