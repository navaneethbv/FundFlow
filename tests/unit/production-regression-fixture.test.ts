import { describe, expect, it } from "vitest";
import {
  buildAccountsPageData,
  type AccountBalanceSnapshot,
  type UnifiedAccountSummary,
} from "@/lib/accounts-page";
import { computeNetWorth, type BalanceAccount } from "@/components/dashboard/metrics";
import { computeSavingsRate } from "@/lib/finance-metrics";
import { shiftMonthKey } from "@/lib/dashboard";
import {
  buildInvestmentAccountCoverage,
  type HoldingJoinRow,
  type InvestmentAccountSummary,
} from "@/lib/investments";
import { toGoalSummaryItem } from "@/lib/goal-summary";
import type { FundedGoal } from "@/lib/goals-v2";
import { normalizeExternalDisplayText } from "@/lib/external-display-text";

describe("Production Live-Data Cross-Surface Reconciliation", () => {
  const NOW = new Date("2026-08-29T12:00:00.000Z");

  it("reconciles net worth with negative credit card balance across Accounts and Dashboard", () => {
    // Fixture representing the exact balance relations:
    // Assets: checking/savings/investments = $58,092.60
    // Credit card 1 (positive debt) = $2,125.30
    // Credit card 2 (Freedom card overpaid credit) = -$2.11
    // Net worth = 58092.60 + 2.11 - 2125.30 = $55,969.41
    const accounts: UnifiedAccountSummary[] = [
      {
        id: "acc-checking",
        ownerUserId: "u1",
        source: "plaid",
        name: "Primary Checking",
        mask: "1111",
        type: "depository",
        subtype: "checking",
        currentBalance: 13669.56,
        availableBalance: null,
        currency: "USD",
        institution: "Bank",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
      {
        id: "acc-401k-1",
        ownerUserId: "u1",
        source: "plaid",
        name: "Retirement 401k A",
        mask: "2222",
        type: "investment",
        subtype: "401k",
        currentBalance: 30000.0,
        availableBalance: null,
        currency: "USD",
        institution: "Fidelity",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
      {
        id: "acc-401k-2",
        ownerUserId: "u1",
        source: "plaid",
        name: "Retirement 401k B",
        mask: "3333",
        type: "investment",
        subtype: "401k",
        currentBalance: 14423.04,
        availableBalance: null,
        currency: "USD",
        institution: "Fidelity",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
      {
        id: "acc-card-owed",
        ownerUserId: "u1",
        source: "plaid",
        name: "Autograph Card",
        mask: "4444",
        type: "credit",
        subtype: "credit card",
        currentBalance: 2125.3,
        availableBalance: null,
        currency: "USD",
        institution: "Wells Fargo",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
      {
        id: "acc-card-credit",
        ownerUserId: "u1",
        source: "plaid",
        name: "Freedom Card",
        mask: "5555",
        type: "credit",
        subtype: "credit card",
        currentBalance: -2.11,
        availableBalance: null,
        currency: "USD",
        institution: "Chase",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
    ];

    const snapshots: AccountBalanceSnapshot[] = accounts.map((a) => ({
      accountId: a.id,
      manualAccountId: null,
      snapshotDate: "2026-08-29",
      currentBalance: a.currentBalance,
      availableBalance: null,
      currency: "USD",
    }));

    // 1. Accounts Page calculation
    const pageData = buildAccountsPageData(accounts, snapshots, NOW);
    const usdAssets = pageData.summary.assets.find((t) => t.currency === "USD")?.amount;
    const usdLiabilities = pageData.summary.liabilities.find((t) => t.currency === "USD")?.amount;
    const usdNetWorth = pageData.summary.netWorth.find((t) => t.currency === "USD")?.amount;

    expect(usdAssets).toBe(58094.71); // 13669.56 + 30000 + 14423.04 + 2.11 credit
    expect(usdLiabilities).toBe(2125.3); // Only the actual debt owed
    expect(usdNetWorth).toBe(55969.41);

    // 2. Dashboard metrics calculation
    const balanceAccounts: BalanceAccount[] = accounts.map((a) => ({
      type: a.type,
      subtype: a.subtype,
      current_balance: a.currentBalance,
    }));
    const dashboardNetWorth = computeNetWorth(balanceAccounts);
    expect(dashboardNetWorth).toBe(55969.41);
    expect(dashboardNetWorth).toBe(usdNetWorth);
  });

  it("reconciles connected retirement accounts without holdings to $44,423.04 total", () => {
    const investmentAccounts: InvestmentAccountSummary[] = [
      {
        id: "inv-1",
        name: "Retirement 401k A",
        source: "plaid",
        type: "investment",
        subtype: "401k",
        balance: 30000.0,
        currency: "USD",
      },
      {
        id: "inv-2",
        name: "Retirement 401k B",
        source: "plaid",
        type: "investment",
        subtype: "401k",
        balance: 14423.04,
        currency: "USD",
      },
    ];
    const holdings: HoldingJoinRow[] = []; // No individual security holding rows yet

    const coverage = buildInvestmentAccountCoverage(investmentAccounts, holdings);
    expect(coverage.accounts).toHaveLength(2);
    expect(coverage.accountsWithoutHoldings).toBe(2);
    expect(coverage.total).toBe(44423.04);
    expect(coverage.accounts[0]!.valueSource).toBe("account-balance");
  });

  it("reconciles funded goal summary to $4,000.00 / $20,000.00", () => {
    const fundedGoal: FundedGoal = {
      id: "goal-1",
      name: "Emergency fund",
      target_amount: 20000,
      saved_amount: 0,
      target_date: "2027-08-01",
      household_id: null,
      goal_type: "save_up",
      image_slug: null,
      monthly_contribution: null,
      spending_reduces: false,
      starting_balance: null,
      target_balance: null,
      funded_amount: 4000,
      remainingAmount: 16000,
      progressPct: 20,
      est_monthly: 1333.33,
      badge: "on-track",
      allocatedFromAccounts: 0,
      eventTotal: 0,
      linkedAccountBalance: 0,
      trailingMonthlyPace: 0,
    };

    const summary = toGoalSummaryItem(fundedGoal);
    expect(summary.fundedAmount).toBe(4000);
    expect(summary.targetAmount).toBe(20000);
    expect(summary.remainingAmount).toBe(16000);
    expect(summary.progressPct).toBe(20);
  });

  it("preserves signed negative savings rates", () => {
    // August: $121.80 income, $13,729.41 spend -> -11172.09%
    expect(computeSavingsRate(121.8, 13729.41)).toBe(-11172.09);

    // Annual: $71,866.97 income, $100,456.92 spend -> -39.78%
    expect(computeSavingsRate(71866.97, 100456.92)).toBe(-39.78);
  });

  it("generates exact 6-month window ending on active month", () => {
    const monthKeys = [5, 4, 3, 2, 1, 0].map((i) => shiftMonthKey("2026-08", -i));
    expect(monthKeys).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(monthKeys).not.toContain("2026-09");
  });

  it("sanitizes Unicode replacement characters in account names", () => {
    expect(
      normalizeExternalDisplayText("WELLS FARGO AUTOGRAPH VISA\uFFFD\uFFFD CARD"),
    ).toBe("WELLS FARGO AUTOGRAPH VISA CARD");
  });
});
