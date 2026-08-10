import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const mockServiceClient = {
  from: vi.fn(),
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockEncryptSecret = vi.fn().mockReturnValue({
  ciphertext: "cipher-123",
  iv: "iv-123",
  tag: "tag-123",
});
const mockDecryptSecret = vi.fn().mockReturnValue("access-token-plain");
const mockDecryptSecretDetailed = vi.fn().mockReturnValue({
  plaintext: "access-token-plain",
  usedFallbackKey: false,
});

vi.mock("@/lib/crypto", () => ({
  encryptSecret: (...args: unknown[]) => mockEncryptSecret(...args),
  decryptSecret: (...args: unknown[]) => mockDecryptSecret(...args),
  decryptSecretDetailed: (...args: unknown[]) => mockDecryptSecretDetailed(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockItemAccessTokenInvalidate = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    itemAccessTokenInvalidate: (...args: unknown[]) =>
      mockItemAccessTokenInvalidate(...args),
  }),
}));

import {
  storeItem,
  decryptItemToken,
  decryptItemTokenAndUpgrade,
  getItemByPlaidItemId,
  listActiveItems,
  getItem,
  upsertAccounts,
  updateItemCursor,
  setItemStatus,
  updateItemBranding,
  getAccountIdMap,
  rotateItemAccessToken,
  rotateStaleItemTokens,
  storeLinkToken,
  consumeLinkToken,
  TOKEN_ROTATION_DAYS,
} from "@/lib/plaid-service";
import type { PlaidItemRow } from "@/lib/types";
import type { AccountBase } from "plaid";

describe("lib/plaid-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyItem: PlaidItemRow = {
    id: "item-db-1",
    user_id: "user-1",
    plaid_item_id: "plaid-item-1",
    institution_id: "inst-1",
    institution_name: "Test Bank",
    access_token_ciphertext: "cipher",
    access_token_iv: "iv",
    access_token_tag: "tag",
    sync_cursor: "cursor-1",
    status: "active",
    error_code: null,
  };

  it("storeItem inserts encrypted token and returns row id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "new-item-id" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    mockServiceClient.from.mockReturnValue({ insert });

    const id = await storeItem({
      userId: "user-1",
      plaidItemId: "plaid-item-1",
      accessToken: "secret-token",
      institutionId: "inst-1",
      institutionName: "Test Bank",
      institutionLogo: "logo-base64",
      institutionBrandColor: "#112233",
    });

    expect(id).toBe("new-item-id");
    expect(mockEncryptSecret).toHaveBeenCalledWith("secret-token");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        access_token_ciphertext: "cipher-123",
        institution_logo: "logo-base64",
        institution_brand_color: "#112233",
      }),
    );
  });

  it("storeItem throws error when insert fails", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: new Error("Insert error") });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    mockServiceClient.from.mockReturnValue({ insert });

    await expect(
      storeItem({
        userId: "user-1",
        plaidItemId: "plaid-item-1",
        accessToken: "secret-token",
      }),
    ).rejects.toThrow("Insert error");
  });

  it("decryptItemToken calls decryptSecret", () => {
    const res = decryptItemToken(dummyItem);
    expect(res).toBe("access-token-plain");
    expect(mockDecryptSecret).toHaveBeenCalledWith({
      ciphertext: dummyItem.access_token_ciphertext,
      iv: dummyItem.access_token_iv,
      tag: dummyItem.access_token_tag,
    });
  });

  it("decryptItemTokenAndUpgrade upgrades token in DB when fallback key was used", async () => {
    mockDecryptSecretDetailed.mockReturnValueOnce({
      plaintext: "old-token-plain",
      usedFallbackKey: true,
    });

    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ update });

    const token = await decryptItemTokenAndUpgrade(dummyItem);

    expect(token).toBe("old-token-plain");
    expect(mockServiceClient.from).toHaveBeenCalledWith("plaid_items");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token_ciphertext: "cipher-123",
      }),
    );
    expect(eq).toHaveBeenCalledWith("id", "item-db-1");
  });

  it("decryptItemTokenAndUpgrade logs error if update fails during key rotation", async () => {
    mockDecryptSecretDetailed.mockReturnValueOnce({
      plaintext: "old-token-plain",
      usedFallbackKey: true,
    });

    const eq = vi.fn().mockResolvedValue({ error: new Error("Update error") });
    const update = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ update });

    const token = await decryptItemTokenAndUpgrade(dummyItem);

    expect(token).toBe("old-token-plain");
    expect(mockLogError).toHaveBeenCalledWith(
      "plaid-service.token-rotation",
      expect.any(Error),
    );
  });

  it("getItemByPlaidItemId fetches item by Plaid item id", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: dummyItem, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ select });

    const item = await getItemByPlaidItemId("plaid-item-1");
    expect(item).toEqual(dummyItem);
  });

  it("listActiveItems returns active items for user", async () => {
    const eqStatus = vi.fn().mockResolvedValue({ data: [dummyItem], error: null });
    const eqUser = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const items = await listActiveItems("user-1");
    expect(items).toEqual([dummyItem]);
  });

  it("getItem returns a single item for user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: dummyItem, error: null });
    const eqItem = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqItem });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const item = await getItem("user-1", "item-db-1");
    expect(item).toEqual(dummyItem);
  });

  it("upsertAccounts upserts mapped account rows", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockReturnValue({ upsert });

    const accounts = [
      {
        account_id: "acc-1",
        name: "Checking",
        official_name: "Super Checking",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        balances: {
          current: 1000,
          available: 900,
          limit: null,
          iso_currency_code: "USD",
        },
      },
    ] as unknown as AccountBase[];

    await upsertAccounts("user-1", "item-db-1", accounts);

    expect(upsert).toHaveBeenCalledWith(
      [
        {
          user_id: "user-1",
          plaid_item_id: "item-db-1",
          plaid_account_id: "acc-1",
          name: "Checking",
          official_name: "Super Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          current_balance: 1000,
          available_balance: 900,
          credit_limit: null,
          iso_currency_code: "USD",
        },
      ],
      { onConflict: "plaid_account_id" },
    );
  });

  it("upsertAccounts does nothing if accounts array is empty", async () => {
    await upsertAccounts("user-1", "item-db-1", []);
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("updateItemCursor updates cursor on plaid_items", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ update });

    await updateItemCursor("item-db-1", "new-cursor");
    expect(update).toHaveBeenCalledWith({ sync_cursor: "new-cursor" });
    expect(eq).toHaveBeenCalledWith("id", "item-db-1");
  });

  it("setItemStatus updates status and error_code", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ update });

    await setItemStatus("item-db-1", "error", "ITEM_LOGIN_REQUIRED");
    expect(update).toHaveBeenCalledWith({
      status: "error",
      error_code: "ITEM_LOGIN_REQUIRED",
    });
  });

  it("updates institution branding with explicit owner scope", async () => {
    const eqUser = vi.fn().mockResolvedValue({ error: null });
    const eqId = vi.fn().mockReturnValue({ eq: eqUser });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    mockServiceClient.from.mockReturnValue({ update });

    await updateItemBranding("user-1", "item-db-1", {
      name: "Test Bank",
      logo: "logo-base64",
      brandColor: "#112233",
    });

    expect(update).toHaveBeenCalledWith({
      institution_name: "Test Bank",
      institution_logo: "logo-base64",
      institution_brand_color: "#112233",
    });
    expect(eqId).toHaveBeenCalledWith("id", "item-db-1");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("getAccountIdMap returns map of plaid_account_id to account id", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [
        { id: "db-acc-1", plaid_account_id: "plaid-acc-1" },
        { id: "db-acc-2", plaid_account_id: "plaid-acc-2" },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ select });

    const map = await getAccountIdMap("user-1");
    expect(map.get("plaid-acc-1")).toBe("db-acc-1");
    expect(map.get("plaid-acc-2")).toBe("db-acc-2");
  });

  it("rotateItemAccessToken rotates the token and persists it encrypted", async () => {
    mockItemAccessTokenInvalidate.mockResolvedValueOnce({
      data: { new_access_token: "rotated-token" },
    });
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ update });

    const ok = await rotateItemAccessToken(dummyItem);

    expect(ok).toBe(true);
    expect(mockItemAccessTokenInvalidate).toHaveBeenCalledWith({
      access_token: "access-token-plain",
    });
    expect(mockEncryptSecret).toHaveBeenCalledWith("rotated-token");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token_ciphertext: "cipher-123",
        access_token_rotated_at: expect.any(String),
      }),
    );
    expect(eq).toHaveBeenCalledWith("id", "item-db-1");
  });

  it("rotateItemAccessToken logs and returns false when rotation fails", async () => {
    mockItemAccessTokenInvalidate.mockRejectedValueOnce(new Error("Plaid failure"));
    mockServiceClient.from.mockReturnValue({ update: vi.fn() });

    const ok = await rotateItemAccessToken(dummyItem);

    expect(ok).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      "plaid-service.token-rotation",
      expect.any(Error),
    );
  });

  it("rotateStaleItemTokens rotates only items never or not recently rotated", async () => {
    const staleItem: PlaidItemRow = { ...dummyItem, id: "item-stale" };
    const freshItem: PlaidItemRow = {
      ...dummyItem,
      id: "item-fresh",
      access_token_rotated_at: new Date().toISOString(),
    };
    const eqStatus = vi.fn().mockResolvedValue({
      data: [staleItem, freshItem],
      error: null,
    });
    const eqUser = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    mockServiceClient.from.mockReturnValue({ select, update });
    mockItemAccessTokenInvalidate.mockResolvedValue({
      data: { new_access_token: "rotated-token" },
    });

    const rotated = await rotateStaleItemTokens("user-1");

    expect(rotated).toBe(1);
    expect(mockItemAccessTokenInvalidate).toHaveBeenCalledTimes(1);
    expect(mockServiceClient.from).toHaveBeenCalledWith("plaid_items");
    expect(TOKEN_ROTATION_DAYS).toBeGreaterThan(0);
  });

  it("throws errors when DB operations fail", async () => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: null, error: new Error("DB Error") });
    chain.then = (res: (v: unknown) => unknown) => res({ data: null, error: new Error("DB List Error") });

    mockServiceClient.from.mockReturnValue({
      select: () => chain,
      upsert: () => Promise.resolve({ error: new Error("Upsert Error") }),
      update: () => ({ eq: () => Promise.resolve({ error: new Error("Update Error") }) }),
    });

    await expect(getItemByPlaidItemId("p1")).rejects.toThrow("DB Error");
    await expect(listActiveItems("u1")).rejects.toThrow("DB List Error");
    await expect(getItem("u1", "i1")).rejects.toThrow("DB Error");
    await expect(getAccountIdMap("u1")).rejects.toThrow("DB List Error");
    await expect(upsertAccounts("u1", "i1", [{ account_id: "a1", balances: {} }] as never)).rejects.toThrow("Upsert Error");
    await expect(updateItemCursor("i1", "c1")).rejects.toThrow("Update Error");
    await expect(setItemStatus("i1", "error")).rejects.toThrow("Update Error");
  });

  it("decryptItemTokenAndUpgrade skips the DB write when the current key was used", async () => {
    mockDecryptSecretDetailed.mockReturnValueOnce({
      plaintext: "access-token-plain",
      usedFallbackKey: false,
    });

    const token = await decryptItemTokenAndUpgrade(dummyItem);

    expect(token).toBe("access-token-plain");
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it("getItemByPlaidItemId returns null when no item matches", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ select });

    const item = await getItemByPlaidItemId("missing-item");
    expect(item).toBeNull();
  });

  it("listActiveItems returns an empty list when no rows exist", async () => {
    const eqStatus = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqUser = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const items = await listActiveItems("user-1");
    expect(items).toEqual([]);
  });

  it("getItem returns null when no matching item exists", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqItem = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqItem });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const item = await getItem("user-1", "no-such-item");
    expect(item).toBeNull();
  });

  it("storeLinkToken inserts a hashed, user-bound token", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockReturnValue({ insert });

    await storeLinkToken("user-1", "link-token-abc", "2026-08-10T00:00:00Z");

    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      token_hash: createHash("sha256").update("link-token-abc").digest("hex"),
      expires_at: "2026-08-10T00:00:00Z",
    });
  });

  it("storeLinkToken stores null expiration when none is provided", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockReturnValue({ insert });

    await storeLinkToken("user-1", "link-token-abc", null);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ expires_at: null }));
  });

  it("storeLinkToken throws when the insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error("Insert error") });
    mockServiceClient.from.mockReturnValue({ insert });

    await expect(storeLinkToken("user-1", "link-token-abc", null)).rejects.toThrow("Insert error");
  });

  it("consumeLinkToken consumes an unused, unexpired token and returns true", async () => {
    const updateEqConsumed = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockReturnValue({ eq: updateEqConsumed });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "lt-1", expires_at: null, consumed_at: null },
      error: null,
    });
    const eqHash = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select, update });

    const ok = await consumeLinkToken("user-1", "link-token-abc");

    expect(ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ consumed_at: expect.any(String) });
  });

  it("consumeLinkToken returns false when the token is not found", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqHash = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const ok = await consumeLinkToken("user-1", "link-token-abc");
    expect(ok).toBe(false);
  });

  it("consumeLinkToken returns false for an already-consumed token", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "lt-1", expires_at: null, consumed_at: "2026-01-01T00:00:00Z" },
      error: null,
    });
    const eqHash = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const ok = await consumeLinkToken("user-1", "link-token-abc");
    expect(ok).toBe(false);
  });

  it("consumeLinkToken returns false for an expired token", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "lt-1", expires_at: "2020-01-01T00:00:00Z", consumed_at: null },
      error: null,
    });
    const eqHash = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const ok = await consumeLinkToken("user-1", "link-token-abc");
    expect(ok).toBe(false);
  });

  it("consumeLinkToken consumes a token that has not expired yet", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "lt-1", expires_at: future, consumed_at: null },
      error: null,
    });
    const updateEqConsumed = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockReturnValue({ eq: updateEqConsumed });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const eqHash = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select, update });

    const ok = await consumeLinkToken("user-1", "link-token-abc");
    expect(ok).toBe(true);
  });

  it("consumeLinkToken throws when the token lookup fails", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("Lookup error") });
    const eqHash = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    await expect(consumeLinkToken("user-1", "link-token-abc")).rejects.toThrow("Lookup error");
  });

  it("consumeLinkToken throws when marking the token consumed fails", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "lt-1", expires_at: null, consumed_at: null },
      error: null,
    });
    const updateEqConsumed = vi.fn().mockResolvedValue({ error: new Error("Consume error") });
    const updateEq = vi.fn().mockReturnValue({ eq: updateEqConsumed });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const eqHash = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqHash });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select, update });

    await expect(consumeLinkToken("user-1", "link-token-abc")).rejects.toThrow("Consume error");
  });

  it("rotateItemAccessToken returns false when Plaid omits the new token", async () => {
    mockItemAccessTokenInvalidate.mockResolvedValueOnce({ data: { new_access_token: null } });
    mockServiceClient.from.mockReturnValue({ update: vi.fn() });

    const ok = await rotateItemAccessToken(dummyItem);

    expect(ok).toBe(false);
    expect(mockEncryptSecret).not.toHaveBeenCalled();
  });

  it("rotateItemAccessToken logs and returns false when persisting the rotated token fails", async () => {
    mockItemAccessTokenInvalidate.mockResolvedValueOnce({
      data: { new_access_token: "rotated-token" },
    });
    const eq = vi.fn().mockResolvedValue({ error: new Error("Update error") });
    const update = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ update });

    const ok = await rotateItemAccessToken(dummyItem);

    expect(ok).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith("plaid-service.token-rotation", expect.any(Error));
  });

  it("rotateStaleItemTokens throws when the item lookup fails", async () => {
    const eqStatus = vi.fn().mockResolvedValue({ data: null, error: new Error("DB Error") });
    const eqUser = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    await expect(rotateStaleItemTokens("user-1")).rejects.toThrow("DB Error");
  });

  it("rotateStaleItemTokens returns 0 when there are no items", async () => {
    const eqStatus = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqUser = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });

    const rotated = await rotateStaleItemTokens("user-1");
    expect(rotated).toBe(0);
  });

  it("rotateStaleItemTokens counts only items whose rotation succeeded", async () => {
    const staleItem = { ...dummyItem, id: "item-stale" };
    const eqStatus = vi.fn().mockResolvedValue({ data: [staleItem], error: null });
    const eqUser = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    mockServiceClient.from.mockReturnValue({ select });
    mockItemAccessTokenInvalidate.mockRejectedValueOnce(new Error("Plaid failure"));

    const rotated = await rotateStaleItemTokens("user-1");
    expect(rotated).toBe(0);
  });

  it("updateItemBranding throws when the update fails", async () => {
    const eqUser = vi.fn().mockResolvedValue({ error: new Error("Branding error") });
    const eqId = vi.fn().mockReturnValue({ eq: eqUser });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    mockServiceClient.from.mockReturnValue({ update });

    await expect(
      updateItemBranding("user-1", "item-db-1", { name: "X", logo: null, brandColor: null }),
    ).rejects.toThrow("Branding error");
  });

  it("getAccountIdMap returns an empty map when no accounts exist", async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const select = vi.fn().mockReturnValue({ eq });
    mockServiceClient.from.mockReturnValue({ select });

    const map = await getAccountIdMap("user-1");
    expect(map.size).toBe(0);
  });
});
