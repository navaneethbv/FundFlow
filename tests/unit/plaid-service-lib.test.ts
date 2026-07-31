import { describe, it, expect, vi, beforeEach } from "vitest";

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
  getAccountIdMap,
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
    });

    expect(id).toBe("new-item-id");
    expect(mockEncryptSecret).toHaveBeenCalledWith("secret-token");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        access_token_ciphertext: "cipher-123",
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

  it("throws errors when DB operations fail", async () => {
    mockServiceClient.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: new Error("DB Error") }) }) }),
      upsert: () => Promise.resolve({ error: new Error("Upsert Error") }),
      update: () => ({ eq: () => Promise.resolve({ error: new Error("Update Error") }) }),
    });

    await expect(getItemByPlaidItemId("p1")).rejects.toThrow("DB Error");
    await expect(upsertAccounts("u1", "i1", [{ account_id: "a1", balances: {} }] as never)).rejects.toThrow("Upsert Error");
    await expect(updateItemCursor("i1", "c1")).rejects.toThrow("Update Error");
    await expect(setItemStatus("i1", "error")).rejects.toThrow("Update Error");
  });
});
