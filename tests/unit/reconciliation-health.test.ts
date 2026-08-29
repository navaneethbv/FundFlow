import { describe, expect, it } from "vitest";
import { buildAccountReconciliation } from "@/lib/sync-health";

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
        transactions: [{ date: "2026-08-28", amount: -500 }],
        historyComplete: true,
      }),
    ).toMatchObject({ ledgerBalance: null, difference: null, state: "missing_anchor" });
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
        transactions: [
          { date: "2026-08-02", amount: -500 },
          { date: "2026-08-03", amount: 175 },
          { date: "2026-08-01", amount: 999 },
        ],
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
        transactions: [{ date: "2026-08-02", amount: 150 }],
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
        transactions: [],
        historyComplete: false,
      }),
    ).toMatchObject({ ledgerBalance: null, difference: null, state: "incomplete_history" });
  });
});
