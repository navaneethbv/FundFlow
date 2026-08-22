import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as exchangePost } from "@/app/api/plaid/exchange/route";
import { POST as receiptsPost, GET as receiptsGet } from "@/app/api/receipts/route";
import { PATCH as receiptPatch, DELETE as receiptDelete } from "@/app/api/receipts/[id]/route";
import * as http from "@/lib/http";
import * as rateLimit from "@/lib/rate-limit";
import * as plaidLib from "@/lib/plaid";
import * as plaidService from "@/lib/plaid-service";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

describe("Plaid Exchange Route Branch Boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles rate limit, bad JSON, and missing token params", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValueOnce(false);
    const reqRate = new NextRequest("http://localhost/api/plaid/exchange", { method: "POST" });
    expect((await exchangePost(reqRate)).status).toBe(429);

    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);

    const reqBadJson = new NextRequest("http://localhost/api/plaid/exchange", {
      method: "POST",
      body: "not json",
    });
    expect((await exchangePost(reqBadJson)).status).toBe(400);

    const reqNoPublicToken = new NextRequest("http://localhost/api/plaid/exchange", {
      method: "POST",
      body: JSON.stringify({ link_token: "link-123" }),
    });
    expect((await exchangePost(reqNoPublicToken)).status).toBe(400);

    const reqNoLinkToken = new NextRequest("http://localhost/api/plaid/exchange", {
      method: "POST",
      body: JSON.stringify({ public_token: "public-123" }),
    });
    expect((await exchangePost(reqNoLinkToken)).status).toBe(400);
  });

  it("handles mismatched public token and invalid link token", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });
    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);

    const mockPlaid = {
      linkTokenGet: vi.fn().mockResolvedValue({
        data: {
          link_sessions: [
            { results: { item_add_results: [{ public_token: "other-token" }] } },
          ],
        },
      }),
    };
    vi.spyOn(plaidLib, "getPlaidClient").mockReturnValue(mockPlaid as never);

    const reqMismatch = new NextRequest("http://localhost/api/plaid/exchange", {
      method: "POST",
      body: JSON.stringify({ public_token: "my-token", link_token: "link-123" }),
    });
    const resMismatch = await exchangePost(reqMismatch);
    expect(resMismatch.status).toBe(400);

    mockPlaid.linkTokenGet.mockResolvedValueOnce({ data: { link_sessions: [] } });
    vi.spyOn(plaidService, "consumeLinkToken").mockResolvedValueOnce(false);

    const reqInvalid = new NextRequest("http://localhost/api/plaid/exchange", {
      method: "POST",
      body: JSON.stringify({ public_token: "my-token", link_token: "link-123" }),
    });
    const resInvalid = await exchangePost(reqInvalid);
    expect(resInvalid.status).toBe(400);
  });

  it("handles successful exchange with legacy link session, null institution, and getItem null", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });
    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);
    vi.spyOn(plaidService, "consumeLinkToken").mockResolvedValue(true);

    const mockPlaid = {
      linkTokenGet: vi.fn().mockResolvedValue({
        data: {
          link_sessions: [
            { on_success: { public_token: "legacy-token" } },
          ],
        },
      }),
      itemPublicTokenExchange: vi.fn().mockResolvedValue({
        data: { access_token: "access-token-xyz", item_id: "plaid-item-xyz" },
      }),
      itemGet: vi.fn().mockResolvedValue({
        data: { item: { institution_id: null } },
      }),
      accountsGet: vi.fn().mockResolvedValue({
        data: { accounts: [] },
      }),
    };
    vi.spyOn(plaidLib, "getPlaidClient").mockReturnValue(mockPlaid as never);
    vi.spyOn(plaidService, "storeItem").mockResolvedValue("item-db-id");
    vi.spyOn(plaidService, "upsertAccounts").mockResolvedValue(undefined);
    vi.spyOn(plaidService, "getItem").mockResolvedValue(null);

    const reqSuccess = new NextRequest("http://localhost/api/plaid/exchange", {
      method: "POST",
      body: JSON.stringify({ public_token: "legacy-token", link_token: "link-123" }),
    });
    const resSuccess = await exchangePost(reqSuccess);
    expect(resSuccess.status).toBe(200);
  });
});

describe("Receipts Upload Route Branch Boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles rate limit, missing file, and validation errors in form data", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValueOnce(false);
    const reqRate = new NextRequest("http://localhost/api/receipts", { method: "POST" });
    expect((await receiptsPost(reqRate)).status).toBe(429);

    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);

    // Missing file
    const formEmpty = new FormData();
    const reqNoFile = new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: formEmpty,
    });
    expect((await receiptsPost(reqNoFile)).status).toBe(400);

    // Merchant too long
    const formLongMerchant = new FormData();
    formLongMerchant.append("file", new File(["test"], "receipt.jpg", { type: "image/jpeg" }));
    formLongMerchant.append("merchant", "a".repeat(200));
    const reqLongMerchant = new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: formLongMerchant,
    });
    expect((await receiptsPost(reqLongMerchant)).status).toBe(400);

    // Invalid purchaseDate
    const formBadDate = new FormData();
    formBadDate.append("file", new File(["test"], "receipt.jpg", { type: "image/jpeg" }));
    formBadDate.append("purchaseDate", "invalid-date");
    const reqBadDate = new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: formBadDate,
    });
    expect((await receiptsPost(reqBadDate)).status).toBe(400);

    // Invalid total <= 0
    const formBadTotal = new FormData();
    formBadTotal.append("file", new File(["test"], "receipt.jpg", { type: "image/jpeg" }));
    formBadTotal.append("total", "-15.00");
    const reqBadTotal = new NextRequest("http://localhost/api/receipts", {
      method: "POST",
      body: formBadTotal,
    });
    expect((await receiptsPost(reqBadTotal)).status).toBe(400);
  });

  it("handles receipts GET retrieval and database errors", async () => {
    const receiptsDataModule = await import("@/lib/receipt-data");
    vi.spyOn(receiptsDataModule, "loadReceiptInbox").mockResolvedValue([
      { id: "r1", fileName: "receipt.jpg", status: "ready" } as never,
    ]);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    const res = await receiptsGet();
    expect(res.status).toBe(200);

    vi.spyOn(receiptsDataModule, "loadReceiptInbox").mockRejectedValue(new Error("Receipt load failed"));
    const resErr = await receiptsGet();
    expect(resErr.status).toBe(500);

    // GET unauthorized
    vi.spyOn(http, "requireUser").mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await receiptsGet()).status).toBe(401);
  });

  it("handles PATCH and DELETE on receipts/[id] with validation, not found, and errors", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), // not found
              }),
            }),
          }),
        }),
      } as never,
    });

    const ctx = { params: Promise.resolve({ id: "r-1" }) };
    const reqNotFound = new NextRequest("http://localhost/api/receipts/r-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "restore" }),
    });
    expect((await receiptPatch(reqNotFound, ctx)).status).toBe(404);
    expect((await receiptDelete(reqNotFound, ctx)).status).toBe(404);

    // Database error in loadOwnedReceipt
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Select error") }),
              }),
            }),
          }),
        }),
      } as never,
    });
    expect((await receiptPatch(reqNotFound, ctx)).status).toBe(500);
    expect((await receiptDelete(reqNotFound, ctx)).status).toBe(500);
  });
});
