import { describe, expect, it, vi } from "vitest";
import {
  evaluateProductHealth,
  loadInstitutionsSyncHealth,
  sanitizeErrorCode,
} from "@/lib/sync-health";

describe("sync-health unit tests", () => {
  describe("sanitizeErrorCode", () => {
    it("handles null and undefined", () => {
      expect(sanitizeErrorCode(null)).toBeNull();
      expect(sanitizeErrorCode(undefined)).toBeNull();
      expect(sanitizeErrorCode("")).toBeNull();
    });

    it("sanitizes repair error codes", () => {
      expect(sanitizeErrorCode("ITEM_LOGIN_REQUIRED")).toBe("ITEM_LOGIN_REQUIRED");
      expect(sanitizeErrorCode("error: INVALID_CREDENTIALS")).toBe("INVALID_CREDENTIALS");
      expect(sanitizeErrorCode("PENDING_EXPIRATION")).toBe("PENDING_EXPIRATION");
    });

    it("sanitizes rate limit codes", () => {
      expect(sanitizeErrorCode("RATE_LIMIT_EXCEEDED")).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("sanitizes unavailable codes", () => {
      expect(sanitizeErrorCode("NO_INVESTMENT_ACCOUNTS")).toBe("NO_INVESTMENT_ACCOUNTS");
      expect(sanitizeErrorCode("PRODUCT_NOT_READY")).toBe("PRODUCT_NOT_READY");
    });

    it("falls back to SYNC_FAILED for generic error messages", () => {
      expect(sanitizeErrorCode("something failed unexpectedly")).toBe("SYNC_FAILED");
    });
  });

  describe("evaluateProductHealth", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");

    it("evaluates healthy state when recently synced", () => {
      const result = evaluateProductHealth({
        itemStatus: "active",
        itemErrorCode: null,
        lastSuccessAt: "2026-08-29T10:00:00.000Z",
        lastAttemptAt: "2026-08-29T10:00:00.000Z",
        lastError: null,
        lastJobStatus: "done",
        now,
      });
      expect(result.state).toBe("healthy");
      expect(result.safeErrorCode).toBeNull();
    });

    it("evaluates repair_required on item error status", () => {
      const result = evaluateProductHealth({
        itemStatus: "error",
        itemErrorCode: "ITEM_LOGIN_REQUIRED",
        lastSuccessAt: "2026-08-20T10:00:00.000Z",
        lastAttemptAt: "2026-08-29T10:00:00.000Z",
        lastError: "ITEM_LOGIN_REQUIRED",
        lastJobStatus: "failed",
        now,
      });
      expect(result.state).toBe("repair_required");
      expect(result.safeErrorCode).toBe("ITEM_LOGIN_REQUIRED");
    });

    it("evaluates rate_limited when provider reports rate limit", () => {
      const result = evaluateProductHealth({
        itemStatus: "active",
        itemErrorCode: null,
        lastSuccessAt: "2026-08-20T10:00:00.000Z",
        lastAttemptAt: "2026-08-29T10:00:00.000Z",
        lastError: "RATE_LIMIT_EXCEEDED",
        lastJobStatus: "failed",
        now,
      });
      expect(result.state).toBe("rate_limited");
      expect(result.safeErrorCode).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("evaluates product_unavailable when no accounts exist for product", () => {
      const result = evaluateProductHealth({
        itemStatus: "active",
        itemErrorCode: null,
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        lastJobStatus: null,
        hasAccountsForProduct: false,
        now,
      });
      expect(result.state).toBe("product_unavailable");
      expect(result.safeErrorCode).toBe("NO_ACCOUNTS");
    });

    it("evaluates never_synced when no attempts exist", () => {
      const result = evaluateProductHealth({
        itemStatus: "active",
        itemErrorCode: null,
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        lastJobStatus: null,
        hasAccountsForProduct: true,
        now,
      });
      expect(result.state).toBe("never_synced");
      expect(result.safeErrorCode).toBeNull();
    });

    it("evaluates stale when last success is over 48 hours ago", () => {
      const result = evaluateProductHealth({
        itemStatus: "active",
        itemErrorCode: null,
        lastSuccessAt: "2026-08-25T10:00:00.000Z",
        lastAttemptAt: "2026-08-25T10:00:00.000Z",
        lastError: null,
        lastJobStatus: "done",
        now,
      });
      expect(result.state).toBe("stale");
    });
  });

  describe("loadInstitutionsSyncHealth", () => {
    it("loads health across items with user scoping", async () => {
      const mockItems = [
        {
          id: "item-1",
          institution_name: "Chase",
          status: "active",
          error_code: null,
          updated_at: "2026-08-29T10:00:00.000Z",
        },
      ];
      const mockAccounts = [
        {
          id: "acc-1",
          plaid_item_id: "item-1",
          type: "depository",
          subtype: "checking",
          updated_at: "2026-08-29T10:00:00.000Z",
        },
      ];
      const mockJobs = [
        {
          plaid_item_id: "item-1",
          job_type: "transactions",
          status: "done",
          last_error: null,
          updated_at: "2026-08-29T10:00:00.000Z",
          created_at: "2026-08-29T10:00:00.000Z",
        },
      ];

      const mockSupabase = {
        from: vi.fn((table: string) => {
          const query = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(() => {
              if (table === "transactions") {
                return Promise.resolve({ data: { date: "2026-08-01" }, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            }),
            then: vi.fn((callback) => {
              if (table === "plaid_items") return Promise.resolve({ data: mockItems, error: null }).then(callback);
              if (table === "accounts") return Promise.resolve({ data: mockAccounts, error: null }).then(callback);
              if (table === "sync_jobs") return Promise.resolve({ data: mockJobs, error: null }).then(callback);
              return Promise.resolve({ data: [], error: null }).then(callback);
            }),
          };
          return query;
        }),
      };

      const result = await loadInstitutionsSyncHealth(
        mockSupabase as unknown as never,
        "user-1",
        new Date("2026-08-29T12:00:00.000Z"),
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.institutionName).toBe("Chase");
      expect(result[0]?.transactions.state).toBe("healthy");
      expect(result[0]?.investments.state).toBe("product_unavailable");
    });
  });
});
