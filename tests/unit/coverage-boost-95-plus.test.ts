import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeSavingsRate } from "@/lib/finance-metrics";
import { resolveAiConsent, isAskAiAvailable } from "@/lib/ai-gate";
import * as aiProvider from "@/lib/ai-provider";
import { recentHistoryStart, isExportAllowed, fetchPrivacySafeRows } from "@/lib/export";
import { calculateFireSimulation } from "@/lib/fire-simulator";
import { parseMonarchBudgets, buildBudgetImportPlan } from "@/lib/budget-import";
import { loadCashFlowData } from "@/lib/cash-flow-data";
import * as financeQuery from "@/lib/finance-query";
import { createNotification } from "@/lib/notifications";
import * as serviceClientModule from "@/lib/supabase/service";
import * as pushModule from "@/lib/push";
import { loadDashboardInvestmentSummary } from "@/lib/dashboard-widgets-data";
import * as holdingsData from "@/lib/investments-data";
import AccountGroup from "@/components/accounts/AccountGroup";
import NetWorthHero from "@/components/accounts/NetWorthHero";
import type { AccountsPageData } from "@/lib/accounts-page";

const asClient = (mock: unknown): SupabaseClient => mock as unknown as SupabaseClient;

describe("Branch coverage boost suite for 95%+ repository target", () => {
  describe("lib/finance-metrics.ts", () => {
    it("covers null/undefined defaults and zero/negative income branches", () => {
      expect(computeSavingsRate()).toBeNull();
      expect(computeSavingsRate(null, null)).toBeNull();
      expect(computeSavingsRate(undefined, undefined)).toBeNull();
      expect(computeSavingsRate(1000, null)).toBe(100);
      expect(computeSavingsRate(1000, undefined)).toBe(100);
      expect(computeSavingsRate(0, 500)).toBeNull();
      expect(computeSavingsRate(-100, 500)).toBeNull();
      expect(computeSavingsRate(1000, 1200)).toBe(-20);
    });
  });

  describe("lib/ai-gate.ts", () => {
    it("handles settings error and profile error in resolveAiConsent", async () => {
      const mockSupabaseSettingsError = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (table === "ai_settings") return { data: null, error: new Error("settings_fail") };
                return { data: { ai_export_enabled: true }, error: null };
              },
            }),
          }),
        }),
      };

      const res1 = await resolveAiConsent(asClient(mockSupabaseSettingsError), "u1");
      expect(res1).toEqual({ allowed: false, reason: "unavailable" });

      const mockSupabaseProfileError = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (table === "ai_settings") return { data: { enabled: true }, error: null };
                return { data: null, error: new Error("profile_fail") };
              },
            }),
          }),
        }),
      };

      const res2 = await resolveAiConsent(asClient(mockSupabaseProfileError), "u1");
      expect(res2).toEqual({ allowed: false, reason: "unavailable" });
    });

    it("handles thrown exception in resolveAiConsent", async () => {
      const mockSupabaseThrow = {
        from: () => {
          throw new Error("unexpected db failure");
        },
      };

      const res = await resolveAiConsent(asClient(mockSupabaseThrow), "u1");
      expect(res).toEqual({ allowed: false, reason: "unavailable" });
    });

    it("evaluates isAskAiAvailable when ai provider is unconfigured or consent is disabled", async () => {
      const spyProvider = vi.spyOn(aiProvider, "isAiProviderConfigured").mockReturnValue(false);
      const mockSupabase = asClient({});

      const availableFalse = await isAskAiAvailable(mockSupabase, "u1");
      expect(availableFalse).toBe(false);

      spyProvider.mockReturnValue(true);
      const mockSupabaseDisabled = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (table === "ai_settings") return { data: { enabled: false }, error: null };
                return { data: { ai_export_enabled: true }, error: null };
              },
            }),
          }),
        }),
      };

      const availableAllowed = await isAskAiAvailable(asClient(mockSupabaseDisabled), "u1");
      expect(availableAllowed).toBe(false);
      spyProvider.mockRestore();
    });
  });

  describe("lib/export.ts", () => {
    it("handles default now in recentHistoryStart", () => {
      const str = recentHistoryStart();
      expect(typeof str).toBe("string");
      expect(str).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("isExportAllowed returns false on missing profile and true on ai_export_enabled: true", async () => {
      const mockSupabaseNoProfile = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
      expect(await isExportAllowed(asClient(mockSupabaseNoProfile), "u1")).toBe(false);

      const mockSupabaseAllowed = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ai_export_enabled: true }, error: null }),
            }),
          }),
        }),
      };
      expect(await isExportAllowed(asClient(mockSupabaseAllowed), "u1")).toBe(true);

      const mockSupabaseError = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: new Error("profile_err") }),
            }),
          }),
        }),
      };
      await expect(isExportAllowed(asClient(mockSupabaseError), "u1")).rejects.toThrow("profile_err");
    });

    it("fetchPrivacySafeRows returns allowed: false when preference is disabled", async () => {
      const mockSupabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ai_export_enabled: false }, error: null }),
            }),
          }),
        }),
      };

      const res = await fetchPrivacySafeRows(asClient(mockSupabase), "u1");
      expect(res).toEqual({ allowed: false });
    });
  });

  describe("lib/fire-simulator.ts", () => {
    it("covers yearsTo65 <= 0 and coastFireTarget, negative networth, and events without spend delta", () => {
      const resOldAge = calculateFireSimulation({
        currentAge: 70,
        currentNetWorth: -5000,
        monthlyIncome: 0,
        monthlySpend: 4000,
        monthlySavings: 0,
        withdrawalRatePct: 0, // tests clamping
        annualReturnPct: -150, // tests clamping
        lifeEvents: [
          {
            id: "ev1",
            name: "Bonus",
            monthOffset: 1,
            oneTimeCashFlow: 10000,
          },
        ],
        projectionHorizonMonths: 2,
      });

      expect(resOldAge.milestones.coastFireTarget).toBe(resOldAge.milestones.standardFireTarget);
      expect(resOldAge.savingsRatePct).toBe(0);
      expect(resOldAge.currentProgressPct).toBe(0);
      expect(resOldAge.timeline).toHaveLength(3);
      expect(resOldAge.timeline[0].netWorthBase).toBe(0);
      expect(resOldAge.timeline[0].netWorthWithEvents).toBe(0);
    });
  });

  describe("lib/budget-import.ts", () => {
    it("covers non-object groups, category > 120 chars, negative amount, and custom group kinds", () => {
      const invalidJson = JSON.stringify({
        groups: [
          {},
          {
            name: "Custom Group",
            type: "custom_type",
            categories: [
              {},
              { name: "A".repeat(150), amount: 100 }, // too long
              { name: "   ", amount: 100 }, // empty
              { name: 123, amount: 100 }, // non-string
              { name: "Valid Category", amount: -50 }, // negative amount
              { name: "Valid Cat 2", amount: "not-a-number" }, // NaN
              { name: "Good Category", amount: 250 }, // valid
            ],
          },
          {
            name: "Non Monthly",
            type: "sinking",
            categories: [{ name: "Sinking Item", amount: "50.5" }],
          },
        ],
      });

      const parsed = parseMonarchBudgets(invalidJson);
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0].category).toBe("Good Category");
      expect(parsed.rows[0].group).toBe("custom");
      expect(parsed.rows[0].groupName).toBe("Custom Group");
      expect(parsed.rows[1].group).toBe("non_monthly");

      const plan = buildBudgetImportPlan(parsed.rows, [
        { category: "Good Category", monthly_limit: 300, group_name: "Custom Group" },
        { category: "Unbudgeted In FundFlow", monthly_limit: 150, group_name: "Fixed" },
      ]);
      expect(plan.conflicts).toHaveLength(1);
      expect(plan.conflicts[0].existingAmount).toBe(300);
      expect(plan.conflicts[0].incomingAmount).toBe(250);
      expect(plan.unbudgetedCategories).toContain("Unbudgeted In FundFlow");
    });
  });

  describe("lib/cash-flow-data.ts", () => {
    it("rethrows unmapped errors in loadCashFlowData and handles error without code in assertQuery", async () => {
      const syncQueryChain = {
        eq: () => syncQueryChain,
        order: () => syncQueryChain,
        limit: () => syncQueryChain,
        maybeSingle: async () => ({ data: null, error: { message: "db_error_no_code" } }),
      };
      const mockSupabase = {
        from: () => ({
          select: () => syncQueryChain,
        }),
      };

      const spyProj = vi.spyOn(financeQuery, "loadCanonicalProjection").mockResolvedValue({
        transactions: [],
        currencyByAccountId: new Map(),
        truncated: false,
      });

      await expect(
        loadCashFlowData(asClient(mockSupabase), {
          scope: { kind: "household", householdId: "hh1" },
          anchorMonth: "2026-09",
          rangeMonths: 6,
        }),
      ).rejects.toThrow("cash_flow_query_failed:sync_jobs");

      // Non-Error thrown
      spyProj.mockRejectedValue("raw string exception");
      await expect(
        loadCashFlowData(asClient(mockSupabase), {
          scope: { kind: "mine", ownerUserId: "u1" },
          anchorMonth: "2026-09",
          rangeMonths: 6,
        }),
      ).rejects.toBe("raw string exception");

      spyProj.mockRestore();
    });

    it("handles invalid or stale timestamp in syncResult", async () => {
      const syncQueryChain = {
        eq: () => syncQueryChain,
        order: () => syncQueryChain,
        limit: () => syncQueryChain,
        maybeSingle: async () => ({
          data: { updated_at: "not-a-valid-date" },
          error: null,
        }),
      };
      const mockSupabase = {
        from: () => ({
          select: () => syncQueryChain,
        }),
      };

      const spyProj = vi.spyOn(financeQuery, "loadCanonicalProjection").mockResolvedValue({
        transactions: [],
        currencyByAccountId: new Map(),
        truncated: false,
      });

      const res = await loadCashFlowData(asClient(mockSupabase), {
        scope: { kind: "mine", ownerUserId: "u1" },
        anchorMonth: "2026-09",
        rangeMonths: 6,
      });
      expect(res.stale).toBe(true);

      spyProj.mockRestore();
    });
  });

  describe("lib/notifications.ts", () => {
    it("handles isUniqueViolation with duplicate key in error message and suppresses in exact dedupe", async () => {
      const mockClient = {
        from: (table: string) => {
          if (table === "alert_preferences") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { broken_bank: true },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "notifications") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: { message: "duplicate key value violates unique constraint" },
                  }),
                }),
              }),
            };
          }
          return {};
        },
      };

      const spyService = vi.spyOn(serviceClientModule, "createServiceClient").mockReturnValue(asClient(mockClient));
      const spyPush = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue({} as never);

      const inserted = await createNotification(
        "u1",
        "broken_bank",
        { title: "Bank Sync Issue", body: "Re-link required" },
        "key-1",
        "exact",
      );

      expect(inserted).toBeNull();

      // Error that is not unique violation gets rethrown
      mockClient.from = (table: string) => {
        if (table === "alert_preferences") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { broken_bank: true }, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: new Error("other_insert_error") }),
            }),
          }),
        };
      };

      await expect(
        createNotification(
          "u1",
          "broken_bank",
          { title: "Bank Sync Issue", body: "Re-link required" },
          "key-2",
          "exact",
        ),
      ).rejects.toThrow("other_insert_error");

      spyService.mockRestore();
      spyPush.mockRestore();
    });
  });

  describe("lib/dashboard-widgets-data.ts", () => {
    it("handles loadDashboardInvestmentSummary with no snapshot dates and coverage without holdings", async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "holding_snapshots") {
            return {
              select: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            };
          }
          return {};
        },
      };

      vi.spyOn(holdingsData, "loadHoldings").mockResolvedValue([]);
      vi.spyOn(holdingsData, "loadInvestmentAccounts").mockResolvedValue([
        {
          id: "acc1",
          name: "Brokerage",
          source: "plaid",
          type: "investment",
          subtype: "brokerage",
          balance: 5000,
          currency: "USD",
        },
      ]);

      const summary = await loadDashboardInvestmentSummary(asClient(mockSupabase), "u1");
      expect(summary.total).toBe(5000);
      expect(summary.hasHoldings).toBe(false);
      expect(summary.hasAccountsWithoutHoldings).toBe(true);

      vi.restoreAllMocks();
    });
  });

  describe("components/accounts/AccountGroup.tsx", () => {
    it("renders with 0 change and negative change", () => {
      const groupDataZeroChange: AccountsPageData["groups"]["cash"] = {
        label: "Checking & Savings",
        rows: [
          {
            id: "acc-1",
            ownerUserId: "u1",
            source: "plaid",
            name: "Checking",
            institution: "Chase",
            institutionLogo: null,
            institutionBrandColor: null,
            type: "depository",
            subtype: "checking",
            currency: "USD",
            balance: 1000,
            updatedAgo: "today",
            stale: false,
            spark: [],
            sparkLong: [],
            includeInNetWorth: true,
            monthChange: { amount: 0, pct: 0 },
          },
        ],
        totals: [{ currency: "USD", amount: 1000 }],
        changes: [{ currency: "USD", amount: 0 }],
      };

      const htmlZero = renderToStaticMarkup(
        createElement(AccountGroup, { groupKey: "cash", group: groupDataZeroChange }),
      );
      expect(htmlZero).not.toContain("this month");

      const groupDataNegativeChange: AccountsPageData["groups"]["cash"] = {
        ...groupDataZeroChange,
        changes: [{ currency: "USD", amount: -150.5 }],
      };

      const htmlNeg = renderToStaticMarkup(
        createElement(AccountGroup, { groupKey: "cash", group: groupDataNegativeChange }),
      );
      expect(htmlNeg).toContain("this month");
      expect(htmlNeg).toContain("-$150.50");
    });
  });

  describe("components/accounts/NetWorthHero.tsx", () => {
    it("renders fallback message when series has fewer than 2 points", () => {
      const summaryFewPoints: AccountsPageData["summary"] = {
        currencies: ["USD"],
        currencyMismatch: false,
        netWorth: [{ currency: "USD", amount: 10000 }],
        netWorthMonthChange: { USD: { amount: -500, pct: -5 } },
        assets: [{ currency: "USD", amount: 12000 }],
        liabilities: [{ currency: "USD", amount: 2000 }],
        assetsByGroup: {},
        liabilitiesByGroup: {},
        netWorthSeries: {
          USD: [{ date: "2026-09-01", value: 10000 }],
        },
      };

      const htmlFew = renderToStaticMarkup(
        createElement(NetWorthHero, { summary: summaryFewPoints, historyStartsOn: "2026-09-01" }),
      );
      expect(htmlFew).toContain("More daily snapshots are needed before a trend can be drawn");
      expect(htmlFew).toContain("↓ $500.00");
    });

    it("renders trend with single-point series alongside multi-point series", () => {
      const summaryMulti: AccountsPageData["summary"] = {
        currencies: ["USD", "EUR"],
        currencyMismatch: true,
        netWorth: [
          { currency: "USD", amount: 10000 },
          { currency: "EUR", amount: 5000 },
        ],
        netWorthMonthChange: {
          USD: { amount: 500, pct: 5 },
          EUR: { amount: -200, pct: -4 },
        },
        assets: [{ currency: "USD", amount: 10000 }],
        liabilities: [],
        assetsByGroup: {},
        liabilitiesByGroup: {},
        netWorthSeries: {
          USD: [
            { date: "2026-09-01", value: 9500 },
            { date: "2026-09-02", value: 10000 },
          ],
          EUR: [
            { date: "2026-09-02", value: 5000 },
          ],
        },
      };

      const htmlMulti = renderToStaticMarkup(
        createElement(NetWorthHero, { summary: summaryMulti, historyStartsOn: "2026-09-01" }),
      );
      expect(htmlMulti).toContain("<svg");
      expect(htmlMulti).toContain("<path");
    });
  });
});
