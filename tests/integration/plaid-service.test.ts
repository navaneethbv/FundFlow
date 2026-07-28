import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  storeItem,
  decryptItemToken,
  decryptItemTokenAndUpgrade,
  listActiveItems,
  getItem,
  upsertAccounts,
  updateItemCursor,
  setItemStatus,
  getAccountIdMap,
} from "@/lib/plaid-service";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && secret);
const suite = run ? describe : describe.skip;

suite("plaid-service DB integration", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";
  let itemDbId = "";
  const plaidItemId = `plaid-item-${stamp}`;
  const accessToken = `access-sandbox-${stamp}`;

  beforeAll(async () => {
    // Create temporary user
    const { data, error } = await admin.auth.admin.createUser({
      email: `plaid-serv-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("stores and encrypts a Plaid access token via storeItem", async () => {
    itemDbId = await storeItem({
      userId,
      plaidItemId,
      accessToken,
      institutionId: "ins_123",
      institutionName: "Chase Bank",
    });

    expect(itemDbId).toBeTruthy();

    // Verify raw DB row has encrypted values but not the plaintext
    const { data } = await admin
      .from("plaid_items")
      .select("access_token_ciphertext, institution_name")
      .eq("id", itemDbId)
      .single();

    expect(data).toBeTruthy();
    expect(data!.institution_name).toBe("Chase Bank");
    expect(data!.access_token_ciphertext).not.toBe(accessToken);
  });

  it("loads the item by id using getItem", async () => {
    const item = await getItem(userId, itemDbId);
    expect(item).toBeTruthy();
    expect(item!.plaid_item_id).toBe(plaidItemId);
    expect(item!.status).toBe("active");
  });

  it("decrypts the access token correctly using decryptItemToken", async () => {
    const item = await getItem(userId, itemDbId);
    const decrypted = decryptItemToken(item!);
    expect(decrypted).toBe(accessToken);
  });

  it("lists active items for the user", async () => {
    const active = await listActiveItems(userId);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(itemDbId);
  });

  it("updates the sync cursor of an item", async () => {
    const newCursor = "cursor-xyz-123";
    await updateItemCursor(itemDbId, newCursor);

    const item = await getItem(userId, itemDbId);
    expect(item!.sync_cursor).toBe(newCursor);
  });

  it("changes item status using setItemStatus", async () => {
    await setItemStatus(itemDbId, "error", "item_login_required");

    const item = await getItem(userId, itemDbId);
    expect(item!.status).toBe("error");
    expect(item!.error_code).toBe("item_login_required");

    // Restore status
    await setItemStatus(itemDbId, "active", null);
    const itemRestored = await getItem(userId, itemDbId);
    expect(itemRestored!.status).toBe("active");
    expect(itemRestored!.error_code).toBeNull();
  });

  it("upserts accounts and builds an account ID map", async () => {
    const mockAccounts = [
      {
        account_id: `acct1-${stamp}`,
        name: "Checking Account",
        official_name: "Chase Total Checking",
        mask: "0000",
        type: "depository" as const,
        subtype: "checking" as const,
        balances: {
          current: 1500.5,
          available: 1450.0,
          limit: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
      },
      {
        account_id: `acct2-${stamp}`,
        name: "Credit Card",
        official_name: "Chase Sapphire",
        mask: "1111",
        type: "credit" as const,
        subtype: "credit card" as const,
        balances: {
          current: 250.0,
          available: null,
          limit: 10000,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
      },
    ];

    await upsertAccounts(userId, itemDbId, mockAccounts as unknown as Parameters<typeof upsertAccounts>[2]);

    const map = await getAccountIdMap(userId);
    expect(map.size).toBe(2);
    expect(map.has(`acct1-${stamp}`)).toBe(true);
    expect(map.has(`acct2-${stamp}`)).toBe(true);

    const dbId1 = map.get(`acct1-${stamp}`);
    const dbId2 = map.get(`acct2-${stamp}`);

    expect(dbId1).toBeTruthy();
    expect(dbId2).toBeTruthy();

    // Verify row contents in the database
    const { data: dbAccount } = await admin
      .from("accounts")
      .select("name, current_balance, available_balance, credit_limit")
      .eq("id", dbId1!)
      .single();

    expect(dbAccount).toBeTruthy();
    expect(dbAccount!.name).toBe("Checking Account");
    expect(Number(dbAccount!.current_balance)).toBe(1500.5);
    expect(Number(dbAccount!.available_balance)).toBe(1450.0);
  });

  it("automatically rotates and re-encrypts tokens when decrypted using fallback key", async () => {
    const crypto = await import("node:crypto");
    const { encryptSecret, decryptSecretDetailed } = await import("@/lib/crypto");

    const originalEncKey = process.env.PLAID_TOKEN_ENC_KEY;
    const fallbackKey = crypto.randomBytes(32).toString("base64");

    // 1. Temporarily swap the encryption key to generate fallback ciphertext
    process.env.PLAID_TOKEN_ENC_KEY = fallbackKey;
    const encPayload = encryptSecret("fallback-token-secret");

    // 2. Set the fallback environment variables
    process.env.PLAID_TOKEN_ENC_KEY = originalEncKey;
    process.env.PLAID_TOKEN_ENC_KEY_PREVIOUS = fallbackKey;

    // 3. Insert this fallback ciphertext into DB
    const { data: item } = await admin
      .from("plaid_items")
      .insert({
        user_id: userId,
        plaid_item_id: `fallback-item-${stamp}`,
        access_token_ciphertext: encPayload.ciphertext,
        access_token_iv: encPayload.iv,
        access_token_tag: encPayload.tag,
        status: "active",
      })
      .select("*")
      .single();

    // 4. Decrypt the token, triggering database upgrade/rotation
    const decrypted = await decryptItemTokenAndUpgrade(item!);
    expect(decrypted).toBe("fallback-token-secret");

    // 5. Fetch from DB again to verify it has been updated with primary key encryption
    const { data: updatedItem } = await admin
      .from("plaid_items")
      .select("access_token_ciphertext, access_token_iv, access_token_tag")
      .eq("id", item!.id)
      .single();

    // It should differ from fallback ciphertext
    expect(updatedItem!.access_token_ciphertext).not.toBe(item!.access_token_ciphertext);

    // It should now decrypt successfully using only the primary key
    delete process.env.PLAID_TOKEN_ENC_KEY_PREVIOUS;
    const decryptedWithPrimary = decryptSecretDetailed({
      ciphertext: updatedItem!.access_token_ciphertext,
      iv: updatedItem!.access_token_iv,
      tag: updatedItem!.access_token_tag,
    });
    expect(decryptedWithPrimary.plaintext).toBe("fallback-token-secret");
    expect(decryptedWithPrimary.usedFallbackKey).toBe(false);

    // Clean up
    await admin.from("plaid_items").delete().eq("id", item!.id);
  });
});
