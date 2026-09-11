import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";

import {
  isHistoryComplete,
  deriveProductSyncHealth,
  buildAccountReconciliation,
} from "@/lib/sync-health";
import { dedupeRelinkedAccounts } from "@/lib/relinked-accounts";
import {
  loadHoldings,
  loadHoldingSnapshots,
  loadInvestmentTransactions,
  loadHoldingAccountOptions,
  loadInvestmentAccounts,
  loadInvestmentSyncStatus,
} from "@/lib/investments-data";
import {
  syncCreditCardLiabilitiesForUser,
} from "@/lib/liabilities-sync";
import { getDashboardData } from "@/lib/dashboard";
import type { PlaidItemRow } from "@/lib/types";
import * as plaidService from "@/lib/plaid-service";
import * as plaidModule from "@/lib/plaid";

describe("Sync and Investments Coverage Boost", () => {
  describe("lib/sync-health.ts", () => {
    it("evaluates isHistoryComplete under all conditional branches", () => {
      const baseCursor = {
        plaidItemId: "item1",
        lastSuccessAt: "2026-01-01T00:00:00.000Z",
        safeErrorCode: null,
      };

      // Missing lastAttemptAt -> true
      expect(isHistoryComplete({
        ...baseCursor,
        state: "healthy",
        lastSyncCompletedPages: true,
        initialHistoryIncomplete: false,
        cursorResetDetectedAt: null,
        lastAttemptAt: null,
      })).toBe(true);

      // Unhealthy state -> false
      expect(isHistoryComplete({
        ...baseCursor,
        state: "failed",
        lastSyncCompletedPages: true,
        initialHistoryIncomplete: false,
        cursorResetDetectedAt: null,
        lastAttemptAt: "2026-01-01T00:00:00.000Z",
      })).toBe(false);

      // Incomplete pages -> false
      expect(isHistoryComplete({
        ...baseCursor,
        state: "healthy",
        lastSyncCompletedPages: false,
        initialHistoryIncomplete: false,
        cursorResetDetectedAt: null,
        lastAttemptAt: "2026-01-01T00:00:00.000Z",
      })).toBe(false);

      // Initial history incomplete -> false
      expect(isHistoryComplete({
        ...baseCursor,
        state: "healthy",
        lastSyncCompletedPages: true,
        initialHistoryIncomplete: true,
        cursorResetDetectedAt: null,
        lastAttemptAt: "2026-01-01T00:00:00.000Z",
      })).toBe(false);

      // Cursor reset detected -> false
      expect(isHistoryComplete({
        ...baseCursor,
        state: "healthy",
        lastSyncCompletedPages: true,
        initialHistoryIncomplete: false,
        cursorResetDetectedAt: "2026-01-01T00:00:00.000Z",
        lastAttemptAt: "2026-01-01T00:00:00.000Z",
      })).toBe(false);

      // Fully complete -> true
      expect(isHistoryComplete({
        ...baseCursor,
        state: "healthy",
        lastSyncCompletedPages: true,
        initialHistoryIncomplete: false,
        cursorResetDetectedAt: null,
        lastAttemptAt: "2026-01-01T00:00:00.000Z",
      })).toBe(true);
    });

    it("evaluates deriveProductSyncHealth under status, code, and timestamp branches", () => {
      const now = new Date("2026-01-10T00:00:00.000Z");

      // Inactive itemStatus -> repair_required
      const r1 = deriveProductSyncHealth({
        itemStatus: "bad",
        itemErrorCode: null,
        latestJob: null,
        latestSuccessfulJob: null,
        now,
      });
      expect(r1.state).toBe("repair_required");

      // Rate limit code
      const r2 = deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: "RATE_LIMIT_EXCEEDED",
        latestJob: null,
        latestSuccessfulJob: null,
        now,
      });
      expect(r2.state).toBe("rate_limited");

      // Product unavailable code
      const r3 = deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: "NO_INVESTMENT_ACCOUNTS",
        latestJob: null,
        latestSuccessfulJob: null,
        now,
      });
      expect(r3.state).toBe("product_unavailable");

      // Failed job status
      const r4 = deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: { status: "failed", last_error: null, updated_at: "2026-01-01" },
        latestSuccessfulJob: null,
        now,
      });
      expect(r4.state).toBe("repair_required");

      // Never synced (no successful job)
      const r5 = deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: { status: "running", last_error: null, updated_at: "2026-01-01" },
        latestSuccessfulJob: null,
        now,
      });
      expect(r5.state).toBe("never_synced");

      // Invalid timestamp on last success -> stale
      const r6 = deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: null,
        latestSuccessfulJob: { status: "done", last_error: null, updated_at: "invalid-date" },
        now,
      });
      expect(r6.state).toBe("stale");

      // Recent success within 48h -> healthy
      const r7 = deriveProductSyncHealth({
        itemStatus: "active",
        itemErrorCode: null,
        latestJob: null,
        latestSuccessfulJob: { status: "done", last_error: null, updated_at: "2026-01-09T12:00:00.000Z" },
        now,
      });
      expect(r7.state).toBe("healthy");
    });

    it("evaluates buildAccountReconciliation missing branches and liability direction", () => {
      // missing_balance
      const rec1 = buildAccountReconciliation({
        account: {
          id: "a1",
          plaidItemId: "p1",
          name: "Checking",
          mask: "1234",
          currentBalance: null,
          type: "depository",
          subtype: "checking",
          updatedAt: "2026-01-01",
        },
        anchor: { currentBalance: 100, snapshotDate: "2026-01-01" },
        transactionTotalCents: 500,
        historyComplete: true,
      });
      expect(rec1.state).toBe("missing_balance");

      // missing_anchor
      const rec2 = buildAccountReconciliation({
        account: {
          id: "a1",
          plaidItemId: "p1",
          name: "",
          mask: null,
          currentBalance: 50,
          type: "depository",
          subtype: "checking",
          updatedAt: null,
        },
        anchor: null,
        transactionTotalCents: 0,
        historyComplete: true,
      });
      expect(rec2.state).toBe("missing_anchor");
      expect(rec2.accountName).toBe("Unnamed account");

      // incomplete_history
      const rec3 = buildAccountReconciliation({
        account: {
          id: "a1",
          plaidItemId: "p1",
          name: "Credit Card",
          mask: "4321",
          currentBalance: 500,
          type: "credit",
          subtype: "credit card",
          updatedAt: "2026-01-01",
        },
        anchor: { currentBalance: 400, snapshotDate: "2026-01-01" },
        coverage: { oldest: "2026-01-01", newest: "2026-01-10" },
        transactionTotalCents: 10000,
        historyComplete: false,
      });
      expect(rec3.state).toBe("incomplete_history");

      // balanced liability account
      // For liability: ledgerCents = anchor(400 * 100) + 1 * 10000 = 50000 cents ($500)
      // provider balance = 500 ($500 -> 50000 cents) -> diff = 0 -> balanced!
      const rec4 = buildAccountReconciliation({
        account: {
          id: "a1",
          plaidItemId: "p1",
          name: "Credit Card",
          mask: "4321",
          currentBalance: 500,
          type: "credit",
          subtype: "credit card",
          updatedAt: "2026-01-01",
        },
        anchor: { currentBalance: 400, snapshotDate: "2026-01-01" },
        transactionTotalCents: 10000,
        historyComplete: true,
      });
      expect(rec4.state).toBe("balanced");
      expect(rec4.ledgerBalance).toBe(500);
      expect(rec4.difference).toBe(0);
    });
  });

  describe("lib/relinked-accounts.ts", () => {
    it("handles equal freshness conflict and missing freshness branches in dedupeRelinkedAccounts", () => {
      // 2 items with identical account set and IDENTICAL freshness -> line 106 continue
      const accountsWithEqualFreshness = [
        {
          id: "a1",
          user_id: "u1",
          plaid_item_id: "item1",
          name: "Checking",
          mask: "1111",
          type: "depository",
          subtype: "checking",
          iso_currency_code: "USD",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a2",
          user_id: "u1",
          plaid_item_id: "item1",
          name: "Savings",
          mask: "2222",
          type: "depository",
          subtype: "savings",
          iso_currency_code: "USD",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "b1",
          user_id: "u1",
          plaid_item_id: "item2",
          name: "Checking",
          mask: "1111",
          type: "depository",
          subtype: "checking",
          iso_currency_code: "USD",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "b2",
          user_id: "u1",
          plaid_item_id: "item2",
          name: "Savings",
          mask: "2222",
          type: "depository",
          subtype: "savings",
          iso_currency_code: "USD",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ];

      const res = dedupeRelinkedAccounts(accountsWithEqualFreshness);
      // Neither suppressed because freshness is equal
      expect(res.length).toBe(4);

      // Account missing mask or name -> accountFingerprint returns null -> signature is null
      const invalidAccount = [
        {
          id: "x1",
          plaid_item_id: "itemX",
          name: null,
          mask: null,
        },
      ];
      expect(dedupeRelinkedAccounts(invalidAccount)).toEqual(invalidAccount);
    });
  });

  describe("lib/investments-data.ts", () => {
    it("handles database errors and options in loadHoldings and loadHoldingSnapshots", async () => {
      const mockSupabaseError = {
        from: (table: string) => {
          if (table === "holdings") {
            return {
              select: async () => ({ data: null, error: new Error("holdings_db_error") }),
            };
          }
          if (table === "holding_snapshots") {
            return {
              select: () => ({
                order: () => ({
                  gte: async () => ({ data: null, error: new Error("snapshots_db_error") }),
                }),
              }),
            };
          }
          if (table === "investment_transactions") {
            return {
              select: () => ({
                eq: () => ({
                  order: async () => ({ data: null, error: new Error("txns_db_error") }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        },
      } as unknown as SupabaseClient;

      await expect(loadHoldings(mockSupabaseError)).rejects.toThrow("holdings_db_error");
      await expect(loadHoldingSnapshots(mockSupabaseError, { since: "2026-01-01" })).rejects.toThrow(
        "snapshots_db_error",
      );
      await expect(loadInvestmentTransactions(mockSupabaseError)).rejects.toThrow("txns_db_error");
    });

    it("loads holding account options with accounts and manual accounts", async () => {
      const client = clientStub({
        accounts: {
          data: [{ id: "acc1", name: null }],
        },
        manual_accounts: {
          data: [{ id: "man1", name: "Manual Brokerage" }],
        },
      });

      const options = await loadHoldingAccountOptions(client as unknown as SupabaseClient, "u1");
      expect(options).toEqual([
        { id: "acc1", name: "Account", source: "plaid" },
        { id: "man1", name: "Manual Brokerage", source: "manual" },
      ]);
    });

    it("loads investment sync status with stale and successful jobs", async () => {
      const client = {
        from: (table: string) => {
          if (table === "plaid_items") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    order: () => ({
                      range: async () => ({
                        data: [{ id: "item1", institution_name: "Vanguard" }],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "sync_jobs") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      order: () => ({
                        range: async () => ({
                          data: [
                            {
                              id: "job1",
                              plaid_item_id: "item1",
                              updated_at: "2020-01-01T00:00:00.000Z", // Very old -> stale
                              status: "done",
                              last_error: null,
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        },
      } as unknown as SupabaseClient;

      const status = await loadInvestmentSyncStatus(client, "u1");
      expect(status).toHaveLength(1);
      expect(status[0]!.institutionName).toBe("Vanguard");
      expect(status[0]!.stale).toBe(true);
    });
  });

  describe("lib/liabilities-sync.ts", () => {
    it("syncs credit card liabilities for user catching errors per item", async () => {
      vi.spyOn(plaidService, "listActiveItems").mockResolvedValue([
        { id: "item1", user_id: "u1" } as unknown as PlaidItemRow,
      ]);
      const count = await syncCreditCardLiabilitiesForUser("u1");
      expect(count).toBe(0);
    });
  });

  describe("lib/dashboard.ts", () => {
    it("assertStage1Success throws when any stage 1 query errors", async () => {
      const client = clientStub({
        budgets: {
          error: new Error("budgets_failed"),
        },
      });

      await expect(getDashboardData(client as unknown as SupabaseClient, undefined, "2026-01", "u1")).rejects.toThrow(
        "dashboard stage1 budgets: budgets_failed",
      );
    });

    it("throws unhandled error when linked_transfers throws non-42P01 error", async () => {
      const baseClient = clientStub();
      const client = {
        from: vi.fn((table: string) => {
          if (table === "linked_transfers") {
            return {
              select: () => ({
                eq: () => {
                  throw new Error("unexpected_transfers_failure");
                },
              }),
            };
          }
          return baseClient.from(table);
        }),
      };

      await expect(getDashboardData(client as unknown as SupabaseClient, undefined, "2026-01", "u1")).rejects.toThrow(
        "unexpected_transfers_failure",
      );
    });
  });
});
