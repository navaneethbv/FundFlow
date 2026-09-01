import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as webhookPost } from "@/app/api/plaid/webhook/route";
import * as plaidService from "@/lib/plaid-service";
import * as investmentSync from "@/lib/investment-sync";
import * as featureFlags from "@/lib/feature-flags";

describe("Plaid Webhook Route Extra Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles verification failure when verification header is missing in production", async () => {
    const origEnv = process.env.PLAID_ENV;
    try {
      process.env.PLAID_ENV = "production";
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({ webhook_type: "ITEM" }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(401);
    } finally {
      process.env.PLAID_ENV = origEnv;
    }
  });

  it("handles missing item_id in TRANSACTIONS webhook", async () => {
    const origEnv = process.env.PLAID_ENV;
    try {
      process.env.PLAID_ENV = "sandbox";
      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({
          webhook_type: "TRANSACTIONS",
          webhook_code: "SYNC_UPDATES_AVAILABLE",
        }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(400);
    } finally {
      process.env.PLAID_ENV = origEnv;
    }
  });

  it("handles ITEM webhook codes: ERROR, PENDING_EXPIRATION, LOGIN_REPAIRED, USER_PERMISSION_REVOKED", async () => {
    const origEnv = process.env.PLAID_ENV;
    try {
      process.env.PLAID_ENV = "sandbox";
      const mockItem = { id: "item-db-1", user_id: "user-1", plaid_item_id: "plaid-item-1" };
      vi.spyOn(plaidService, "getItemByPlaidItemId").mockResolvedValue(mockItem as never);
      const setStatusSpy = vi.spyOn(plaidService, "setItemStatus").mockResolvedValue();

      // ERROR with fallback code
      const reqError = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({
          webhook_type: "ITEM",
          webhook_code: "ERROR",
          item_id: "plaid-item-1",
        }),
      });
      expect((await webhookPost(reqError)).status).toBe(200);
      expect(setStatusSpy).toHaveBeenCalledWith("user-1", "item-db-1", "error", "ITEM_ERROR");

      // PENDING_EXPIRATION
      const reqPending = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({
          webhook_type: "ITEM",
          webhook_code: "PENDING_EXPIRATION",
          item_id: "plaid-item-1",
        }),
      });
      expect((await webhookPost(reqPending)).status).toBe(200);
      expect(setStatusSpy).toHaveBeenCalledWith("user-1", "item-db-1", "active", "PENDING_EXPIRATION");

      // LOGIN_REPAIRED
      const reqRepaired = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({
          webhook_type: "ITEM",
          webhook_code: "LOGIN_REPAIRED",
          item_id: "plaid-item-1",
        }),
      });
      expect((await webhookPost(reqRepaired)).status).toBe(200);
      expect(setStatusSpy).toHaveBeenCalledWith("user-1", "item-db-1", "active", null);

      // USER_PERMISSION_REVOKED
      const reqRevoked = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({
          webhook_type: "ITEM",
          webhook_code: "USER_PERMISSION_REVOKED",
          item_id: "plaid-item-1",
        }),
      });
      expect((await webhookPost(reqRevoked)).status).toBe(200);
      expect(setStatusSpy).toHaveBeenCalledWith("user-1", "item-db-1", "disconnected", "USER_PERMISSION_REVOKED");
    } finally {
      process.env.PLAID_ENV = origEnv;
    }
  });

  it("handles HOLDINGS webhook HISTORICAL_UPDATE with investmentsPage flag enabled", async () => {
    const origEnv = process.env.PLAID_ENV;
    try {
      process.env.PLAID_ENV = "sandbox";
      vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(true);
      const mockItem = { id: "item-db-1", user_id: "user-1", plaid_item_id: "plaid-item-1" };
      vi.spyOn(plaidService, "getItemByPlaidItemId").mockResolvedValue(mockItem as never);
      const syncInvestmentsSpy = vi.spyOn(investmentSync, "syncInvestmentsForItem").mockResolvedValue({
        outcome: "synced",
        holdingsSynced: 5,
      });

      const req = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({
          webhook_type: "HOLDINGS",
          webhook_code: "HISTORICAL_UPDATE",
          item_id: "plaid-item-1",
        }),
      });
      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      expect(syncInvestmentsSpy).toHaveBeenCalled();

      // ITEM webhook when item not found
      vi.spyOn(plaidService, "getItemByPlaidItemId").mockResolvedValue(null);
      const reqNotFound = new NextRequest("http://localhost/api/plaid/webhook", {
        method: "POST",
        body: JSON.stringify({
          webhook_type: "ITEM",
          webhook_code: "ERROR",
          item_id: "plaid-unknown",
        }),
      });
      expect((await webhookPost(reqNotFound)).status).toBe(200);
    } finally {
      process.env.PLAID_ENV = origEnv;
    }
  });
});
