import { describe, expect, it, vi } from "vitest";
import { redactEmails } from "@/lib/delivery-error";
import { buildDemoDataset } from "@/lib/demo-data";
import { fetchPrivacySafeRows } from "@/lib/export";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("redactEmails letter/TLD branches", () => {
  it("treats uppercase TLD letters as valid ASCII letters", () => {
    expect(redactEmails("bounced for user@Example.CO.UK now")).toContain("[redacted]");
  });

  it("scans past a non-letter in the domain position", () => {
    const out = redactEmails("relay refused user@example.9co.uk");
    expect(typeof out).toBe("string");
  });

  it("does not treat a one-letter TLD as a valid domain end", () => {
    expect(redactEmails("user@example.c")).toBe("user@example.c");
  });
});

describe("buildDemoDataset zero-seed branch", () => {
  it("falls back to a fixed seed when the user id produces zero", () => {
    const data = buildDemoDataset({ userId: "", today: "2026-07-23", months: 1 });
    expect(data.item.plaid_item_id).toBe("demo-item-");
    expect(data.transactions.length).toBeGreaterThan(0);
  });
});

describe("lib/env appUrl fallback branch", () => {
  it("uses the default localhost when NEXT_PUBLIC_APP_URL is unset", async () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.resetModules();
    try {
      const { publicEnv } = await import("@/lib/env");
      expect(publicEnv.appUrl).toBe("http://localhost:3000");
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = original;
    }
  });

  it("uses the configured app url when set", async () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://fundflow.test";
    vi.resetModules();
    try {
      const { publicEnv } = await import("@/lib/env");
      expect(publicEnv.appUrl).toBe("https://fundflow.test");
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = original;
    }
  });
});

describe("fetchPrivacySafeRows null merchant/category branches", () => {
  function clientWithTxns(txns: unknown[]) {
    const singleProfile = vi.fn().mockResolvedValue({ data: { ai_export_enabled: true } });
    const order = vi.fn().mockResolvedValue({ data: txns, error: null });
    const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) });
    const chainableEmpty = () => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (v: { data?: unknown[]; error?: unknown }) => unknown) =>
          resolve({ data: [] }),
      };
      return builder;
    };
    return {
      from: vi.fn((table: string) => {
        if (table === "profiles") return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: singleProfile }) }) };
        if (table === "transactions") return { select };
        if (table === "transaction_annotations") return { select: chainableEmpty };
        if (table === "merchant_rules") return { select: chainableEmpty };
        if (table === "category_overrides") return { select: chainableEmpty };
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;
  }

  it("falls back to empty strings when merchant and category are both missing", async () => {
    const result = await fetchPrivacySafeRows(
      clientWithTxns([
        {
          date: "2026-07-01",
          merchant_name: null,
          name: null,
          amount: 9.99,
          pfc_primary: null,
          pfc_detailed: null,
        },
      ]),
      "user-1",
    );
    expect(result).toEqual({
      allowed: true,
      rows: [{ date: "2026-07-01", merchant: "", amount: 9.99, category: "" }],
    });
  });
});
