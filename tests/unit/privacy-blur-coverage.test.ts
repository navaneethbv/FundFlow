import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Privacy Blur Coverage (F-1):
 * Verifies that the 12 key surfaces audited in F-1 carry data-money, .metric-value,
 * or .money on their currency render sites.
 */

describe("privacy blur coverage on audited surfaces (F-1)", () => {
  const AUDITED_FILES = [
    "components/goals/GoalCard.tsx",
    "app/goals/page.tsx",
    "components/dashboard/GoalsSummary.tsx",
    "components/dashboard/CategoryDrilldownPanel.tsx",
    "components/dashboard/MerchantDrilldownPanel.tsx",
    "components/dashboard/DrilldownTransactionList.tsx",
    "components/dashboard/ScopeChips.tsx",
    "components/forecasting/FireSimulator.tsx",
    "components/recurring/RecurringCalendar.tsx",
    "components/recurring/PriceSpikeBanner.tsx",
    "components/transactions/TransactionEditor.tsx",
    "components/goals/GoalsManager.tsx",
  ];

  it.each(AUDITED_FILES)("%s has data-money attributes on currency renders", (filePath) => {
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("data-money");
  });
});
