import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const projection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/finance-query", () => ({ loadCanonicalProjection: projection }));
import { loadCollections } from "@/lib/collections-data";
let annotations: unknown[];
let budgets: unknown[];
let failure: Error | null;
const query = (table: string) => ({
  select() { return this; }, eq() { return this; }, not() { return this; }, order() { return this; },
  async range(start: number, end: number) { return { data: annotations.slice(start, end + 1), error: failure }; },
  async limit() { return { data: table === "transaction_collections" ? budgets : [], error: failure }; },
});
const client = { from: vi.fn(query) } as unknown as SupabaseClient;
beforeEach(() => { annotations = []; budgets = []; failure = null; projection.mockResolvedValue({ transactions: [], truncated: false }); });
it("uses canonical expense values so splits, refunds, income, and exclusions agree with the ledger", async () => {
  annotations = ["charge", "income", "transfer", "excluded"].map((transaction_id) => ({ transaction_id, tags: ["collection:Trip"] }));
  budgets = [{ name: "Trip", budget: 500 }];
  projection.mockResolvedValue({ truncated: false, transactions: [
    { sourceTransactionId: "charge", date: "2026-10-01", signedAmount: 60, flow: "expense" },
    { sourceTransactionId: "charge", date: "2026-10-01", signedAmount: 40, flow: "expense" },
    { sourceTransactionId: "income", date: "2026-10-01", signedAmount: -1000, flow: "income" },
    { sourceTransactionId: "transfer", date: "2026-10-01", signedAmount: 500, flow: "transfer" },
  ] });
  expect(await loadCollections(client, "owner")).toEqual([{ name: "Trip", spent: 100, count: 3, firstDate: "2026-10-01", lastDate: "2026-10-01", budget: 500, remaining: 400 }]);
  expect(projection).toHaveBeenCalledWith(client, expect.objectContaining({ scope: { kind: "mine", ownerUserId: "owner" } }));
});
it("paginates beyond the server's first thousand annotations", async () => {
  annotations = Array.from({ length: 1001 }, (_, i) => ({ transaction_id: String(i), tags: ["collection:Trip"] }));
  projection.mockResolvedValue({ truncated: false, transactions: [{ sourceTransactionId: "1000", date: "2026-10-01", signedAmount: 25, flow: "expense" }] });
  expect(await loadCollections(client, "owner")).toMatchObject([{ spent: 25 }]);
});
it("refuses partial reads and propagates query errors", async () => {
  projection.mockResolvedValue({ truncated: true, transactions: [] });
  await expect(loadCollections(client, "owner")).rejects.toThrow("limit");
  projection.mockResolvedValue({ truncated: false, transactions: [] });
  budgets = Array(501).fill({}); await expect(loadCollections(client, "owner")).rejects.toThrow("limit");
  budgets = []; annotations = Array(5001).fill({}); await expect(loadCollections(client, "owner")).rejects.toThrow("limit");
  annotations = []; failure = new Error("read failed"); await expect(loadCollections(client, "owner")).rejects.toThrow("read failed");
});
