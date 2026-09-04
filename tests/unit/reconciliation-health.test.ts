import { describe, expect, it } from "vitest";
import { buildAccountReconciliation, isHistoryComplete } from "@/lib/sync-health";

describe("buildAccountReconciliation", () => {
  it("refuses to invent a ledger balance without a snapshot anchor", () => {
    expect(
      buildAccountReconciliation({
        account: {
          id: "checking",
          plaidItemId: "item-1",
          name: "Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          currentBalance: 1000,
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
        anchor: null,
        transactionTotalCents: -50000,
        historyComplete: true,
      }),
    ).toMatchObject({ ledgerBalance: null, difference: null, state: "missing_anchor" });
  });

  it("normalizes corrupted provider account labels", () => {
    expect(
      buildAccountReconciliation({
        account: {
          id: "checking",
          plaidItemId: "item-1",
          name: "Bank\uFFFD  Checking",
          mask: null,
          type: "depository",
          subtype: "checking",
          currentBalance: null,
          updatedAt: null,
        },
        anchor: null,
        transactionTotalCents: 0,
        historyComplete: true,
      }),
    ).toMatchObject({ accountName: "Bank Checking" });
  });

  it("calculates an asset ledger from a real earlier balance snapshot", () => {
    expect(
      buildAccountReconciliation({
        account: {
          id: "checking",
          plaidItemId: "item-1",
          name: "Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          currentBalance: 1325,
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
        anchor: { snapshotDate: "2026-08-01", currentBalance: 1000 },
        transactionTotalCents: -32500,
        historyComplete: true,
      }),
    ).toMatchObject({ ledgerBalance: 1325, difference: 0, state: "balanced" });
  });

  it("uses liability balance direction for credit accounts", () => {
    expect(
      buildAccountReconciliation({
        account: {
          id: "card",
          plaidItemId: "item-1",
          name: "Card",
          mask: null,
          type: "credit",
          subtype: "credit card",
          currentBalance: 250,
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
        anchor: { snapshotDate: "2026-08-01", currentBalance: 100 },
        transactionTotalCents: 15000,
        historyComplete: true,
      }),
    ).toMatchObject({ ledgerBalance: 250, difference: 0, state: "balanced" });
  });

  it("marks an incomplete paginated history as unavailable", () => {
    expect(
      buildAccountReconciliation({
        account: {
          id: "checking",
          plaidItemId: "item-1",
          name: "Checking",
          mask: null,
          type: "depository",
          subtype: "checking",
          currentBalance: 100,
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
        anchor: { snapshotDate: "2026-08-01", currentBalance: 100 },
        transactionTotalCents: 0,
        historyComplete: false,
      }),
    ).toMatchObject({ ledgerBalance: null, difference: null, state: "incomplete_history" });
  });

  it("keeps cent arithmetic exact across many fractional values", () => {
    expect(
      buildAccountReconciliation({
        account: {
          id: "checking",
          plaidItemId: "item-1",
          name: "Checking",
          mask: null,
          type: "depository",
          subtype: "checking",
          currentBalance: 99.9,
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
        anchor: { snapshotDate: "2026-08-01", currentBalance: 100 },
        transactionTotalCents: 10,
        historyComplete: true,
      }),
    ).toMatchObject({ ledgerBalance: 99.9, difference: 0, state: "balanced" });
  });
});

describe("isHistoryComplete", () => {
  const base = {
    plaidItemId: "item-1",
    lastAttemptAt: "2026-08-29T00:00:00.000Z",
    lastSuccessAt: "2026-08-29T00:05:00.000Z",
    lastSyncCompletedPages: true,
    initialHistoryIncomplete: false,
    cursorResetDetectedAt: null,
    safeErrorCode: null,
    state: "healthy" as const,
  };

  it("treats a drained, gap-free sync as complete", () => {
    expect(isHistoryComplete(base)).toBe(true);
  });

  it("reports incomplete history when the last run stopped mid-pagination", () => {
    expect(
      isHistoryComplete({
        ...base,
        lastSyncCompletedPages: false,
        state: "partial_page",
      }),
    ).toBe(false);
  });

  it("reports incomplete history after a detected cursor reset", () => {
    expect(
      isHistoryComplete({
        ...base,
        cursorResetDetectedAt: "2026-08-29T00:00:00.000Z",
        state: "cursor_reset",
      }),
    ).toBe(false);
  });

  it("reports incomplete history while the initial backfill is unfinished", () => {
    expect(
      isHistoryComplete({
        ...base,
        initialHistoryIncomplete: true,
        state: "backfill_incomplete",
      }),
    ).toBe(false);
  });

  it("does not flag an item whose flags are still migration defaults", () => {
    // No recorded attempt means no evidence either way; flagging here would
    // mark every account incomplete for a whole day after the migration lands.
    expect(
      isHistoryComplete({
        ...base,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastSyncCompletedPages: false,
        state: "never_synced",
      }),
    ).toBe(true);
  });
});
