import { describe, it, expect } from "vitest";
import { normalizeManualTxn } from "@/lib/manual-transaction";

const TODAY = "2026-07-30";

function body(partial: Record<string, unknown> = {}) {
  return {
    kind: "debit",
    amount: 42.5,
    merchant: "Corner Store",
    date: "2026-07-29",
    account: { source: "manual", id: "man-1" },
    category: "food_and_drink",
    goalId: null,
    notes: null,
    ...partial,
  };
}

describe("normalizeManualTxn", () => {
  it("accepts a valid debit and stores it as a positive signed amount", () => {
    const result = normalizeManualTxn(body({ kind: "debit", amount: 50 }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.signedAmount).toBe(50);
  });

  it("accepts a valid credit and stores it as a negative signed amount", () => {
    const result = normalizeManualTxn(body({ kind: "credit", amount: 50 }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.signedAmount).toBe(-50);
  });

  it("rejects a kind that is neither debit nor credit", () => {
    expect(normalizeManualTxn(body({ kind: "transfer" }), TODAY).ok).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    expect(normalizeManualTxn(body({ amount: 0 }), TODAY).ok).toBe(false);
    expect(normalizeManualTxn(body({ amount: -5 }), TODAY).ok).toBe(false);
  });

  it("rejects an amount above the sanity bound", () => {
    expect(normalizeManualTxn(body({ amount: 10_000_000 }), TODAY).ok).toBe(false);
  });

  it("rejects an empty or overlong merchant", () => {
    expect(normalizeManualTxn(body({ merchant: "" }), TODAY).ok).toBe(false);
    expect(normalizeManualTxn(body({ merchant: "x".repeat(121) }), TODAY).ok).toBe(false);
  });

  it("trims merchant whitespace", () => {
    const result = normalizeManualTxn(body({ merchant: "  Corner Store  " }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.merchant).toBe("Corner Store");
  });

  it("rejects a malformed or future date", () => {
    expect(normalizeManualTxn(body({ date: "07/29/2026" }), TODAY).ok).toBe(false);
    expect(normalizeManualTxn(body({ date: "2026-07-31" }), TODAY).ok).toBe(false);
    expect(normalizeManualTxn(body({ date: TODAY }), TODAY).ok).toBe(true);
  });

  it("rejects a missing or malformed account reference", () => {
    expect(normalizeManualTxn(body({ account: undefined }), TODAY).ok).toBe(false);
    expect(normalizeManualTxn(body({ account: { source: "other", id: "x" } }), TODAY).ok).toBe(false);
    expect(normalizeManualTxn(body({ account: { source: "plaid", id: "" } }), TODAY).ok).toBe(false);
  });

  it("accepts a plaid account reference as well as a manual one", () => {
    const result = normalizeManualTxn(body({ account: { source: "plaid", id: "acct-1" } }), TODAY);
    expect(result.ok).toBe(true);
  });

  it("normalizes a blank category to null", () => {
    const result = normalizeManualTxn(body({ category: "  " }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.category).toBeNull();
  });

  it("normalizes a blank goalId to null", () => {
    const result = normalizeManualTxn(body({ goalId: "" }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.goalId).toBeNull();
  });

  it("passes through a valid goalId", () => {
    const result = normalizeManualTxn(body({ goalId: "goal-1" }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.goalId).toBe("goal-1");
  });

  it("trims and caps notes at 500 characters", () => {
    const result = normalizeManualTxn(body({ notes: `  ${"a".repeat(600)}  ` }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notes).toHaveLength(500);
  });

  it("normalizes blank notes to null", () => {
    const result = normalizeManualTxn(body({ notes: "   " }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notes).toBeNull();
  });
});
