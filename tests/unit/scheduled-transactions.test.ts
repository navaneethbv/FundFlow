import { describe, it, expect } from "vitest";
import {
  isDue,
  normalizeScheduledTxn,
  scheduledPlaidTxnId,
  toPromotedTransactionRow,
  toRecurringItem,
} from "@/lib/scheduled-transactions";

const VALID = {
  kind: "debit",
  amount: 500,
  merchant: "Landlord",
  date: "2026-09-25",
  account: { source: "plaid", id: "acc-1" },
  category: "rent",
  notes: "September rent",
};

describe("normalizeScheduledTxn", () => {
  it("accepts a future-dated entry and resolves the Plaid sign", () => {
    const result = normalizeScheduledTxn(VALID, "2026-09-02");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.signedAmount).toBe(500);
      expect(result.value.date).toBe("2026-09-25");
    }
  });

  it("credits are negative (money in)", () => {
    const result = normalizeScheduledTxn({ ...VALID, kind: "credit" }, "2026-09-02");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.signedAmount).toBe(-500);
  });

  it("rejects past dates (the inverted manual-entry guard)", () => {
    const result = normalizeScheduledTxn({ ...VALID, date: "2026-08-31" }, "2026-09-02");
    expect(result).toMatchObject({ ok: false });
  });

  it("allows today and one day ahead (UTC-east client default)", () => {
    expect(normalizeScheduledTxn({ ...VALID, date: "2026-09-02" }, "2026-09-02").ok).toBe(true);
    expect(normalizeScheduledTxn({ ...VALID, date: "2026-09-03" }, "2026-09-02").ok).toBe(true);
  });

  it("rejects dates more than ten years out", () => {
    const result = normalizeScheduledTxn({ ...VALID, date: "2046-09-04" }, "2026-09-02");
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects bad amounts, merchants, kinds, and accounts", () => {
    expect(normalizeScheduledTxn({ ...VALID, amount: 0 }, "2026-09-02").ok).toBe(false);
    expect(normalizeScheduledTxn({ ...VALID, amount: -5 }, "2026-09-02").ok).toBe(false);
    expect(normalizeScheduledTxn({ ...VALID, merchant: "  " }, "2026-09-02").ok).toBe(false);
    expect(normalizeScheduledTxn({ ...VALID, kind: "transfer" }, "2026-09-02").ok).toBe(false);
    expect(
      normalizeScheduledTxn({ ...VALID, account: { source: "cash", id: "x" } }, "2026-09-02").ok,
    ).toBe(false);
  });

  it("trims and bounds notes and category", () => {
    const result = normalizeScheduledTxn(
      { ...VALID, notes: "  save me  ", category: "  Rent  " },
      "2026-09-02",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notes).toBe("save me");
      expect(result.value.category).toBe("Rent");
    }
  });
});

describe("promotion helpers", () => {
  it("builds a deterministic provenance id", () => {
    expect(scheduledPlaidTxnId("abc-123")).toBe("scheduled-abc-123");
  });

  it("maps a due row to the ledger row shape (debit positive, credit negative)", () => {
    const row = {
      id: "s1",
      user_id: "u1",
      kind: "debit",
      amount: "500.00",
      merchant: "Landlord",
      scheduled_date: "2026-09-25",
      category: "rent",
      account_id: "acc-1",
      manual_account_id: null,
    };
    expect(toPromotedTransactionRow("u1", row)).toEqual({
      user_id: "u1",
      account_id: "acc-1",
      manual_account_id: null,
      plaid_transaction_id: "scheduled-s1",
      amount: 500,
      date: "2026-09-25",
      name: "Landlord",
      merchant_name: "Landlord",
      pfc_primary: "rent",
      source: "manual",
      pending: false,
    });
  });

  it("isDue requires status scheduled and date at or before today", () => {
    expect(isDue({ status: "scheduled", scheduled_date: "2026-09-02" }, "2026-09-02")).toBe(true);
    expect(isDue({ status: "scheduled", scheduled_date: "2026-09-01" }, "2026-09-02")).toBe(true);
    expect(isDue({ status: "scheduled", scheduled_date: "2026-09-03" }, "2026-09-02")).toBe(false);
    expect(isDue({ status: "promoted", scheduled_date: "2026-09-01" }, "2026-09-02")).toBe(false);
    expect(isDue({ status: "cancelled", scheduled_date: "2026-09-01" }, "2026-09-02")).toBe(false);
  });
});

describe("toRecurringItem", () => {
  it("projects as a one-off expense/income on its date", () => {
    expect(
      toRecurringItem({
        kind: "debit",
        amount: "500.00",
        merchant: "Landlord",
        scheduled_date: "2026-09-25",
        category: "rent",
      }),
    ).toEqual({
      name: "Landlord",
      amount: 500,
      itemType: "expense",
      frequency: "once",
      nextDate: "2026-09-25",
      category: "rent",
    });
    expect(
      toRecurringItem({
        kind: "credit",
        amount: "-1200",
        merchant: "Bonus",
        scheduled_date: "2026-12-15",
        category: null,
      }).itemType,
    ).toBe("income");
  });
});

describe("normalizeScheduledTxn — remaining validation branches", () => {
  it("rejects non-string kinds, dates, and non-finite amounts", () => {
    expect(normalizeScheduledTxn({ ...VALID, kind: 1 }, "2026-09-02").ok).toBe(false);
    expect(normalizeScheduledTxn({ ...VALID, date: 20260925 }, "2026-09-02").ok).toBe(false);
    expect(normalizeScheduledTxn({ ...VALID, amount: Number.NaN }, "2026-09-02").ok).toBe(false);
    expect(normalizeScheduledTxn({ ...VALID, amount: 1_000_001 }, "2026-09-02").ok).toBe(false);
  });

  it("rejects merchants longer than 120 characters", () => {
    const result = normalizeScheduledTxn({ ...VALID, merchant: "x".repeat(121) }, "2026-09-02");
    expect(result.ok).toBe(false);
  });

  it("clamps over-long categories and notes rather than rejecting", () => {
    const result = normalizeScheduledTxn(
      { ...VALID, category: "c".repeat(200), notes: "n".repeat(600) },
      "2026-09-02",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.category).toHaveLength(120);
      expect(result.value.notes).toHaveLength(500);
    }
  });

  it("treats empty category and notes as null", () => {
    const result = normalizeScheduledTxn({ ...VALID, category: "   ", notes: "" }, "2026-09-02");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.category).toBeNull();
      expect(result.value.notes).toBeNull();
    }
  });

  it("rejects a null body", () => {
    expect(normalizeScheduledTxn(null, "2026-09-02").ok).toBe(false);
  });
});
