import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReconciliationSection from "@/components/settings/ReconciliationSection";
import type { AccountReconciliationRow } from "@/lib/reconcile-data";

describe("ReconciliationSection UI", () => {
  it("renders empty state when rows is empty", () => {
    const html = renderToStaticMarkup(<ReconciliationSection rows={[]} />);
    expect(html).toContain("No accounts available to reconcile.");
  });

  it("renders reconciliation rows for connected accounts in desktop table and mobile cards", () => {
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
        transactionCount: 42,
        isStale: false,
        coverageStart: "2026-01-01",
        coverageEnd: "2026-08-28",
        lastSyncAt: "2026-08-29T10:00:00Z",
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
        transactionCount: 0,
        isStale: true,
        coverageStart: null,
        coverageEnd: null,
        lastSyncAt: null,
      },
    ];

    const html = renderToStaticMarkup(<ReconciliationSection rows={rows} />);
    expect(html).toContain("Checking Account");
    expect(html).toContain("Credit Card");
    expect(html).toContain("Stale (&gt;48h)");
    expect(html).toContain("Fresh");
  });
});
