import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPrivacySafeRows, isExportAllowed } from "@/lib/export";
import type { SupabaseClient } from "@supabase/supabase-js";

type ExportSeed = {
  data: unknown;
  error?: unknown;
};

function pagedExportClient(seeds: Record<string, ExportSeed>) {
  const calls: Record<string, Array<{ method: string; args: unknown[] }>> = {};
  const from = vi.fn((table: string) => {
    const tableCalls = (calls[table] ??= []);
    let range: [number, number] | null = null;
    let inFilter: { column: string; values: unknown[] } | null = null;
    let maybeSingle = false;
    const builder = {
      select(...args: unknown[]) {
        tableCalls.push({ method: "select", args });
        return builder;
      },
      eq(...args: unknown[]) {
        tableCalls.push({ method: "eq", args });
        return builder;
      },
      in(column: string, values: unknown[]) {
        tableCalls.push({ method: "in", args: [column, values] });
        inFilter = { column, values };
        return builder;
      },
      order(...args: unknown[]) {
        tableCalls.push({ method: "order", args });
        return builder;
      },
      limit(...args: unknown[]) {
        tableCalls.push({ method: "limit", args });
        return builder;
      },
      gte(...args: unknown[]) {
        tableCalls.push({ method: "gte", args });
        return builder;
      },
      range(fromIndex: number, toIndex: number) {
        tableCalls.push({ method: "range", args: [fromIndex, toIndex] });
        range = [fromIndex, toIndex];
        return builder;
      },
      maybeSingle() {
        tableCalls.push({ method: "maybeSingle", args: [] });
        maybeSingle = true;
        return builder;
      },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        const seed = seeds[table] ?? { data: [] };
        let data = seed.data;
        if (Array.isArray(data) && inFilter) {
          const filter = inFilter;
          data = data.filter((row) =>
            filter.values.includes((row as Record<string, unknown>)[filter.column]),
          );
        }
        if (Array.isArray(data)) {
          const [fromIndex, toIndex] = range ?? [0, 999];
          const pageData = data.slice(fromIndex, toIndex + 1);
          data = maybeSingle ? (pageData[0] ?? null) : pageData;
        }
        return resolve({ data, error: seed.error ?? null });
      },
    };
    return builder;
  });
  return { from, calls };
}

function transaction(index: number) {
  return {
    id: `txn-${String(index).padStart(4, "0")}`,
    user_id: "user-1",
    account_id: "account-1",
    manual_account_id: null,
    plaid_transaction_id: `plaid-${index}`,
    date: "2026-07-01",
    merchant_name: `Merchant ${index}`,
    name: null,
    amount: index + 1,
    pfc_primary: "FOOD_AND_DRINK",
    pfc_detailed: null,
    pending: false,
  };
}

describe("lib/export", () => {
  let mockSupabase: Partial<SupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isExportAllowed", () => {
    it("returns true when ai_export_enabled is true", async () => {
      const single = vi.fn().mockResolvedValue({ data: { ai_export_enabled: true } });
      const eq = vi.fn().mockReturnValue({ maybeSingle: single });
      const select = vi.fn().mockReturnValue({ eq });
      mockSupabase = { from: vi.fn().mockReturnValue({ select }) };

      const allowed = await isExportAllowed(mockSupabase as SupabaseClient, "user-1");
      expect(allowed).toBe(true);
    });

    it("returns false when ai_export_enabled is false", async () => {
      const single = vi.fn().mockResolvedValue({ data: { ai_export_enabled: false } });
      const eq = vi.fn().mockReturnValue({ maybeSingle: single });
      const select = vi.fn().mockReturnValue({ eq });
      mockSupabase = { from: vi.fn().mockReturnValue({ select }) };

      const allowed = await isExportAllowed(mockSupabase as SupabaseClient, "user-1");
      expect(allowed).toBe(false);
    });

    it("fails closed when the profile row is missing", async () => {
      const single = vi.fn().mockResolvedValue({ data: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle: single });
      const select = vi.fn().mockReturnValue({ eq });
      mockSupabase = { from: vi.fn().mockReturnValue({ select }) };

      const allowed = await isExportAllowed(mockSupabase as SupabaseClient, "user-1");
      expect(allowed).toBe(false);
    });

    it("throws when the profile query errors", async () => {
      const single = vi.fn().mockResolvedValue({ data: null, error: new Error("db down") });
      const eq = vi.fn().mockReturnValue({ maybeSingle: single });
      const select = vi.fn().mockReturnValue({ eq });
      mockSupabase = { from: vi.fn().mockReturnValue({ select }) };

      await expect(
        isExportAllowed(mockSupabase as SupabaseClient, "user-1"),
      ).rejects.toThrow("db down");
    });
  });

  describe("fetchPrivacySafeRows", () => {
    it("pages transactions and rule dependencies completely with stable order", async () => {
      const transactions = Array.from({ length: 1_001 }, (_, index) => transaction(index));
      const rules = Array.from({ length: 1_001 }, (_, index) => ({
        id: `rule-${index}`,
        match_type: "merchant",
        pattern: `Merchant ${index}`,
        display_name: null,
        category: null,
        enabled: false,
      }));
      const categoryOverrides = Array.from({ length: 1_001 }, (_, index) => ({
        id: `category-${index}`,
        source_category: `SOURCE_${index}`,
        display_category: `DISPLAY_${index}`,
      }));
      const client = pagedExportClient({
        profiles: { data: { ai_export_enabled: true } },
        transactions: { data: transactions },
        transaction_annotations: { data: [] },
        merchant_rules: { data: rules },
        category_overrides: { data: categoryOverrides },
      });

      const result = await fetchPrivacySafeRows(client as never, "user-1");

      expect(result.allowed && result.rows).toHaveLength(1_001);
      expect(client.calls.transactions.filter((call) => call.method === "range")).toHaveLength(2);
      expect(client.calls.transactions.filter((call) => call.method === "order")).toEqual([
        { method: "order", args: ["date", { ascending: false }] },
        { method: "order", args: ["id", { ascending: false }] },
        { method: "order", args: ["date", { ascending: false }] },
        { method: "order", args: ["id", { ascending: false }] },
      ]);
      expect(client.calls.merchant_rules.filter((call) => call.method === "range")).toHaveLength(2);
      expect(client.calls.merchant_rules.filter((call) => call.method === "order")).toEqual([
        { method: "order", args: ["created_at"] },
        { method: "order", args: ["id"] },
        { method: "order", args: ["created_at"] },
        { method: "order", args: ["id"] },
      ]);
      expect(client.calls.category_overrides.filter((call) => call.method === "range")).toHaveLength(2);
    });

    it("chunks transaction annotation lookups by transaction id", async () => {
      const client = pagedExportClient({
        profiles: { data: { ai_export_enabled: true } },
        transactions: {
          data: Array.from({ length: 501 }, (_, index) => transaction(index)),
        },
        transaction_annotations: { data: [] },
        merchant_rules: { data: [] },
        category_overrides: { data: [] },
      });

      await fetchPrivacySafeRows(client as never, "user-1");

      const annotationChunks = client.calls.transaction_annotations.filter(
        (call) => call.method === "in" && call.args[0] === "transaction_id",
      );
      expect(annotationChunks).toHaveLength(3);
      expect(annotationChunks.every((call) => (call.args[1] as unknown[]).length <= 250)).toBe(true);
    });

    it.each(["transaction_annotations", "merchant_rules", "category_overrides"])(
      "fails when the %s dependency query errors",
      async (failedTable) => {
        const client = pagedExportClient({
          profiles: { data: { ai_export_enabled: true } },
          transactions: { data: [transaction(0)] },
          transaction_annotations: { data: [] },
          merchant_rules: { data: [] },
          category_overrides: { data: [] },
          [failedTable]: { data: [], error: new Error(`${failedTable} failed`) },
        });

        await expect(
          fetchPrivacySafeRows(client as never, "user-1"),
        ).rejects.toThrow(`${failedTable} failed`);
      },
    );

    it("returns allowed: false when profile has ai_export_enabled: false", async () => {
      const singleProfile = vi.fn().mockResolvedValue({
        data: { ai_export_enabled: false },
      });
      const eqProfile = vi.fn().mockReturnValue({ maybeSingle: singleProfile });
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
      const txnsData = [
        {
          ...transaction(0),
          date: "2026-07-01",
          merchant_name: "Coffee Shop",
          name: "Raw Description",
          amount: 4.5,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_COFFEE_SHOP",
        },
        {
          ...transaction(1),
          date: "2026-07-02",
          merchant_name: null,
          name: "Gas Station",
          amount: 35.0,
          pfc_primary: "TRANSPORTATION",
          pfc_detailed: null,
        },
      ];
      const client = pagedExportClient({
        profiles: { data: { ai_export_enabled: true } },
        transactions: { data: txnsData },
        transaction_annotations: { data: [] },
        merchant_rules: { data: [] },
        category_overrides: { data: [] },
      });

      const result = await fetchPrivacySafeRows(
        client as never,
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

    it("applies splits, refund netting, and duplicate exclusion in exports", async () => {
      const client = pagedExportClient({
        profiles: { data: { ai_export_enabled: true } },
        transactions: {
          data: [
            { ...transaction(0), id: "split", amount: 100 },
            { ...transaction(1), id: "charge", amount: 40 },
            { ...transaction(2), id: "refund", amount: -40 },
            { ...transaction(3), id: "duplicate", amount: 25 },
          ],
        },
        transaction_annotations: { data: [] },
        merchant_rules: { data: [] },
        category_overrides: { data: [] },
        transaction_splits: {
          data: [
            { transaction_id: "split", category: "Needs", amount: 60 },
            { transaction_id: "split", category: "Wants", amount: 40 },
          ],
        },
        linked_refunds: {
          data: [{ charge_transaction_id: "charge", refund_transaction_id: "refund" }],
        },
        linked_duplicates: {
          data: [{ excluded_transaction_id: "duplicate" }],
        },
      });

      const result = await fetchPrivacySafeRows(client as never, "user-1");

      expect(result.allowed && result.rows).toEqual([
        expect.objectContaining({ amount: 60, category: "Needs" }),
        expect.objectContaining({ amount: 40, category: "Wants" }),
        expect.objectContaining({ amount: 40 }),
        expect.objectContaining({ amount: -40 }),
      ]);
      expect(
        result.allowed && result.rows.some((row) => row.merchant === "Merchant 3"),
      ).toBe(false);
    });

    it("can bound the transaction query before projecting AI history", async () => {
      const client = pagedExportClient({
        profiles: { data: { ai_export_enabled: true } },
        transactions: { data: [transaction(0)] },
        transaction_annotations: { data: [] },
        merchant_rules: { data: [] },
        category_overrides: { data: [] },
        transaction_splits: { data: [] },
        linked_refunds: { data: [] },
        linked_duplicates: { data: [] },
      });

      await fetchPrivacySafeRows(client as never, "user-1", {
        startDate: "2026-03-01",
      });

      expect(client.calls.transactions).toContainEqual({
        method: "gte",
        args: ["date", "2026-03-01"],
      });
    });

    it("throws error when transaction query fails", async () => {
      const client = pagedExportClient({
        profiles: { data: { ai_export_enabled: true } },
        transactions: { data: [], error: new Error("DB Error") },
      });

      await expect(
        fetchPrivacySafeRows(client as never, "user-1"),
      ).rejects.toThrow("DB Error");
    });
  });
});
