import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDate } from "@/lib/date-utils";
import { parseImportCsv } from "@/lib/import";
import { parseYnabCsv } from "@/lib/import-ynab";
import { clientStub } from "../fixtures/supabase-query";
import { loadRecurringData } from "@/lib/recurring-data";

describe("recurring-data with real stream rows", () => {
  it("runs the per-stream projection arrows", async () => {
    const client = clientStub({
      households: { data: [] },
      recurring_streams: {
        data: [
          {
            id: "s1",
            user_id: "user-1",
            merchant_name: "Netflix",
            description: null,
            stream_type: "outflow",
            status: "MATURE",
            is_active: true,
            reviewed_at: null,
            dismissed_at: null,
            user_amount: null,
            average_amount: 15.49,
            last_amount: null,
            frequency: "MONTHLY",
            first_date: "2026-01-15",
            last_date: "2026-06-15",
            predicted_next_date: "2026-07-15",
            account_id: "a1",
            category: "ENTERTAINMENT",
          },
        ],
      },
      recurring_stream_transactions: {
        data: [{ recurring_stream_id: "s1", transaction_id: "t1" }],
      },
      transactions: { data: [{ id: "t1", date: "2026-07-14" }] },
      manual_recurring_items: {
        data: [
          {
            id: "m1",
            name: "Rent",
            amount: 1200,
            frequency: "monthly",
            next_date: "2026-08-01",
            item_type: "fixed",
            category: "HOUSING",
            enabled: true,
          },
        ],
      },
      accounts: {
        data: [
          { id: "a1", name: "Checking", type: "depository", subtype: null, iso_currency_code: "USD" },
        ],
      },
      sync_jobs: { data: { updated_at: new Date().toISOString() } },
    });
    const result = await loadRecurringData(client as unknown as SupabaseClient, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.reviewCount).toBe(1);
    expect(result.manualItems).toHaveLength(1);
    expect(result.allStreams[0]!.merchantName).toBe("Netflix");
    expect(result.stale).toBe(false);
    expect(result.currency).toBe("USD");
  });
});

describe("date-utils nullish fallbacks", () => {
  it("treats missing month and day segments as January 1", () => {
    // "2026" -> month and day undefined -> ?? 1 each
    expect(parseDate("2026").toISOString().slice(0, 10)).toBe("2026-01-01");
    // "2026-07" -> day undefined -> ?? 1
    expect(parseDate("2026-07").toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});

describe("import ragged short rows", () => {
  it("hits the nullish column fallbacks for a single-amount layout", () => {
    const csv = ["Date,Description,Amount,Category", "2026-07-01,Store"].join("\n");
    const res = parseImportCsv(csv, { positiveIsIncome: false });
    // amount column absent from the row -> "" -> unrecognized amount
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0]).toContain("unrecognized amount");
  });

  it("hits the empty-description branch when the amount precedes the description column", () => {
    const csv = ["Date,Amount,Description", "2026-07-01,5.00"].join("\n");
    const res = parseImportCsv(csv, {
      positiveIsIncome: false,
      columns: { date: 0, description: 2, amount: 1, debit: null, credit: null, category: null },
    });
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0]).toContain("empty description");
  });

  it("hits the nullish fallbacks for a debit/credit layout", () => {
    const csv = ["Date,Description,Debit,Credit", "2026-07-01,Store"].join("\n");
    const res = parseImportCsv(csv, { positiveIsIncome: false });
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0]).toContain("unrecognized amount");
  });
});

describe("import-ynab category fallback with a short row", () => {
  it("falls back through the bare category column when the combined column is absent from the row", () => {
    const csv = [
      '"Date","Payee","Outflow","Inflow","Category Group/Category","Category"',
      '"2026-07-01","Store","10.00",""',
    ].join("\n");
    const res = parseYnabCsv(csv);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]!.category).toBeNull();
    expect(res.rows[0]!.amount).toBe(10);
  });
});