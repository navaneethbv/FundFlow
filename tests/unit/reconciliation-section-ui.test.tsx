import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ReconciliationSection from "@/components/settings/ReconciliationSection";
import type { AccountReconciliationRow } from "@/lib/reconcile-data";

describe("ReconciliationSection UI", () => {
  it("renders empty state when rows is empty", () => {
    render(<ReconciliationSection rows={[]} />);
    expect(screen.getByText("No accounts available to reconcile.")).toBeDefined();
  });

  it("renders reconciliation rows for connected accounts in both desktop table and mobile view", () => {
    const rows: AccountReconciliationRow[] = [
      {
        accountId: "acc-1",
        accountName: "Checking Account",
        institutionName: "Chase",
        type: "depository",
        subtype: "checking",
        providerBalance: 5000,
        calculatedLedgerBalance: 4800,
        difference: 200,
        currency: "USD",
        oldestTransactionDate: "2026-01-01",
        newestTransactionDate: "2026-08-28",
        transactionCount: 42,
        isStale: false,
        coverageStart: "2026-01-01",
        coverageEnd: "2026-08-28",
      },
      {
        accountId: "acc-2",
        accountName: "Credit Card",
        institutionName: "Amex",
        type: "credit",
        subtype: "credit card",
        providerBalance: 1200,
        calculatedLedgerBalance: 1200,
        difference: 0,
        currency: "USD",
        oldestTransactionDate: null,
        newestTransactionDate: null,
        transactionCount: 0,
        isStale: true,
        coverageStart: null,
        coverageEnd: null,
      },
    ];

    render(<ReconciliationSection rows={rows} />);
    expect(screen.getAllByText("Checking Account").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Credit Card").length).toBeGreaterThan(0);
    expect(screen.getByText("Stale (>48h)")).toBeDefined();
    expect(screen.getByText("Fresh")).toBeDefined();
  });
});
