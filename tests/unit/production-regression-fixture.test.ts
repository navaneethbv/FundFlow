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

describe("synthetic cross-surface reconciliation", () => {
  const NOW = new Date("2026-08-29T12:00:00.000Z");

  it("reconciles net worth with negative credit card balance across Accounts and Dashboard", () => {
    // Synthetic fixture: assets include an overpaid-card credit while only a
    // positive credit-card balance contributes to liabilities.
    const accounts: UnifiedAccountSummary[] = [
      {
        id: "acc-checking",
        ownerUserId: "u1",
        source: "plaid",
        name: "Primary Checking",
        mask: "1111",
        type: "depository",
        subtype: "checking",
        currentBalance: 10000,
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
        name: "Investment Account A",
        mask: "2222",
        type: "investment",
        subtype: "401k",
        currentBalance: 20000,
        availableBalance: null,
        currency: "USD",
        institution: "Brokerage",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
      {
        id: "acc-401k-2",
        ownerUserId: "u1",
        source: "plaid",
        name: "Investment Account B",
        mask: "3333",
        type: "investment",
        subtype: "401k",
        currentBalance: 15000,
        availableBalance: null,
        currency: "USD",
        institution: "Brokerage",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
      {
        id: "acc-card-owed",
        ownerUserId: "u1",
        source: "plaid",
        name: "Credit Card",
        mask: "4444",
        type: "credit",
        subtype: "credit card",
        currentBalance: 2500,
        availableBalance: null,
        currency: "USD",
        institution: "Card Issuer",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-08-29T10:00:00Z",
        includeInNetWorth: true,
      },
      {
        id: "acc-card-credit",
        ownerUserId: "u1",
        source: "plaid",
        name: "Overpaid Card",
        mask: "5555",
        type: "credit",
        subtype: "credit card",
        currentBalance: -5,
        availableBalance: null,
        currency: "USD",
        institution: "Card Issuer",
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

    expect(usdAssets).toBe(45005);
    expect(usdLiabilities).toBe(2500);
    expect(usdNetWorth).toBe(42505);

    // 2. Dashboard metrics calculation
    const balanceAccounts: BalanceAccount[] = accounts.map((a) => ({
      type: a.type,
      subtype: a.subtype,
      current_balance: a.currentBalance,
    }));
    const dashboardNetWorth = computeNetWorth(balanceAccounts);
    expect(dashboardNetWorth).toBe(42505);
    expect(dashboardNetWorth).toBe(usdNetWorth);
  });

  it("reconciles connected investment accounts without holdings", () => {
    const investmentAccounts: InvestmentAccountSummary[] = [
      {
        id: "inv-1",
        name: "Investment Account A",
        source: "plaid",
        type: "investment",
        subtype: "401k",
        balance: 20000,
        currency: "USD",
      },
      {
        id: "inv-2",
        name: "Investment Account B",
        source: "plaid",
        type: "investment",
        subtype: "401k",
        balance: 15000,
        currency: "USD",
      },
    ];
    const holdings: HoldingJoinRow[] = []; // No individual security holding rows yet

    const coverage = buildInvestmentAccountCoverage(investmentAccounts, holdings);
    expect(coverage.accounts).toHaveLength(2);
    expect(coverage.accountsWithoutHoldings).toBe(2);
    expect(coverage.total).toBe(35000);
    expect(coverage.accounts[0]!.valueSource).toBe("account-balance");
  });

  it("reconciles a synthetic funded goal summary", () => {
    const fundedGoal: FundedGoal = {
      id: "goal-1",
      name: "Emergency fund",
      target_amount: 15000,
      saved_amount: 0,
      target_date: "2027-08-01",
      household_id: null,
      goal_type: "save_up",
      image_slug: null,
      monthly_contribution: null,
      spending_reduces: false,
      starting_balance: null,
      target_balance: null,
      funded_amount: 3000,
      remainingAmount: 12000,
      progressPct: 20,
      est_monthly: 1000,
      badge: "on-track",
      allocatedFromAccounts: 0,
      eventTotal: 0,
      linkedAccountBalance: 0,
      trailingMonthlyPace: 0,
    };

    const summary = toGoalSummaryItem(fundedGoal);
    expect(summary.fundedAmount).toBe(3000);
    expect(summary.targetAmount).toBe(15000);
    expect(summary.remainingAmount).toBe(12000);
    expect(summary.progressPct).toBe(20);
  });

  it("preserves signed negative savings rates", () => {
    expect(computeSavingsRate(1000, 1250)).toBe(-25);
    expect(computeSavingsRate(60000, 75000)).toBe(-25);
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
      normalizeExternalDisplayText("EXAMPLE BANK REWARDS\uFFFD\uFFFD CARD"),
    ).toBe("EXAMPLE BANK REWARDS CARD");
  });
});
