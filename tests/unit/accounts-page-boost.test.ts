import { describe, expect, it } from "vitest";
import {
  accountsViewIsFiltered,
  applyAccountsPageView,
  buildAccountsPageData,
  groupKeyFor,
  type UnifiedAccountSummary,
  type AccountBalanceSnapshot,
} from "@/lib/accounts-page";

const NOW = new Date("2026-07-29T12:00:00.000Z");

describe("Accounts Page Extra Branches", () => {
  it("checks accountsViewIsFiltered for each option", () => {
    expect(accountsViewIsFiltered({ visibility: "all" })).toBe(false);
    expect(accountsViewIsFiltered({})).toBe(true);
    expect(accountsViewIsFiltered({ groupKey: "cash" })).toBe(true);
    expect(accountsViewIsFiltered({ institution: "Chase" })).toBe(true);
    expect(accountsViewIsFiltered({ ownerUserId: "u-1" })).toBe(true);
    expect(accountsViewIsFiltered({ visibility: "hidden" })).toBe(true);
    expect(accountsViewIsFiltered({ hiddenIds: ["acc-1"], visibility: "all" })).toBe(true);
  });

  it("handles groupKeyFor various subtypes and fallback", () => {
    expect(groupKeyFor("depository", "checking")).toBe("cash");
    expect(groupKeyFor("credit", "credit card")).toBe("credit");
    expect(groupKeyFor("loan", "mortgage")).toBe("loan");
    expect(groupKeyFor("investment", "brokerage")).toBe("investment");
    expect(groupKeyFor("unknown", "unknown")).toBe("other");
  });

  it("filters and sorts accounts data by groupKey, institution, owner, order tie-breakers, and visibility", () => {
    const accounts: UnifiedAccountSummary[] = [
      {
        id: "acc-1",
        ownerUserId: "user-1",
        source: "plaid",
        name: "Checking B",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 1000,
        availableBalance: 1000,
        currency: "USD",
        institution: "Chase",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-07-29T11:59:00.000Z", // 1 minute ago
        includeInNetWorth: true,
      },
      {
        id: "acc-2",
        ownerUserId: "user-2",
        source: "manual",
        name: "Checking A",
        mask: "5678",
        type: "depository",
        subtype: "savings",
        currentBalance: null,
        availableBalance: null,
        currency: "USD",
        institution: "BoA",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-07-29T10:00:00.000Z", // 2 hours ago
        includeInNetWorth: true,
      },
      {
        id: "acc-3",
        ownerUserId: "user-1",
        source: "plaid",
        name: "Old Debt",
        mask: "9999",
        type: "loan",
        subtype: "mortgage",
        currentBalance: 50000,
        availableBalance: null,
        currency: "USD",
        institution: "Wells",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "invalid-date",
        includeInNetWorth: true,
      },
      {
        id: "acc-4",
        ownerUserId: "user-1",
        source: "manual",
        name: "Checking C",
        mask: "4321",
        type: "depository",
        subtype: "checking",
        currentBalance: 200,
        availableBalance: 200,
        currency: "USD",
        institution: "Chase",
        institutionLogo: null,
        institutionBrandColor: null,
        updatedAt: "2026-07-28T12:00:00.000Z", // 1 day ago
        includeInNetWorth: true,
      },
    ];

    const snapshots: AccountBalanceSnapshot[] = [
      {
        accountId: "acc-1",
        manualAccountId: null,
        snapshotDate: "2026-07-01",
        currentBalance: 800,
        availableBalance: null,
        currency: "USD",
      },
      {
        accountId: "acc-1",
        manualAccountId: null,
        snapshotDate: "2026-07-29",
        currentBalance: 1000,
        availableBalance: null,
        currency: "USD",
      },
      // Single snapshot for acc-4 (testing first === latest branch)
      {
        accountId: "acc-4",
        manualAccountId: null,
        snapshotDate: "2026-07-29",
        currentBalance: 200,
        availableBalance: null,
        currency: "USD",
      },
    ];

    const pageData = buildAccountsPageData(accounts, snapshots, NOW);
    expect(pageData.groups.cash.rows).toHaveLength(3);

    // Filter hidden
    const hiddenView = applyAccountsPageView(pageData, {
      visibility: "hidden",
      hiddenIds: ["acc-2"],
    });
    expect(hiddenView.groups.cash.rows).toHaveLength(1);
    expect(hiddenView.groups.cash.rows[0]?.id).toBe("acc-2");

    // Filter by groupKey, institution, ownerUserId, order with tie-breakers
    const filteredView = applyAccountsPageView(pageData, {
      groupKey: "cash",
      institution: "Chase",
      ownerUserId: "user-1",
      order: ["acc-4", "acc-1"],
      visibility: "visible",
      hiddenIds: ["acc-2"],
    });
    expect(filteredView.groups.cash.rows).toHaveLength(2);
    expect(filteredView.groups.cash.rows[0]?.id).toBe("acc-4");
    expect(filteredView.groups.cash.rows[1]?.id).toBe("acc-1");
    expect(filteredView.groups.loan.rows).toHaveLength(0);

    // Unordered tie-breaker (same order, sort by name)
    const unorderedView = applyAccountsPageView(pageData, {
      groupKey: "cash",
      institution: "Chase",
      ownerUserId: "user-1",
      order: [],
      visibility: "visible",
      hiddenIds: ["acc-2"],
    });
    expect(unorderedView.groups.cash.rows[0]?.name).toContain("Checking B");
    expect(unorderedView.groups.cash.rows[1]?.name).toContain("Checking C");
  });
});
