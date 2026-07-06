import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { POST as plaidWebhookPost } from "@/app/api/plaid/webhook/route";
import { NextRequest } from "next/server";
import { storeItem } from "@/lib/plaid-service";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && secret);
const suite = run ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let syncTriggeredWith: any = null;

vi.mock("@/lib/sync", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sync")>();
  return {
    ...original,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    syncItemTransactions: async (item: any) => {
      syncTriggeredWith = item;
      return { added: 1, modified: 0, removed: 0 };
    },
  };
});

suite("plaid webhook integration", () => {
  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";
  let itemDbId = "";
  const plaidItemId = `plaid-item-web-${stamp}`;

  beforeAll(async () => {
    // 1. Create temporary user
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email: `web-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = userData.user.id;

    // 2. Store item with the specific plaid_item_id
    itemDbId = await storeItem({
      userId,
      plaidItemId,
      accessToken: "mock-token",
    });
  });

  afterAll(async () => {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("ignores non-sync webhooks and returns 200", async () => {
    syncTriggeredWith = null;

    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "INITIAL_UPDATE",
        item_id: plaidItemId,
      }),
    });

    const resp = await plaidWebhookPost(req);
    expect(resp.status).toBe(200);
    expect(syncTriggeredWith).toBeNull();
  });

  it("triggers transaction sync for matching items on SYNC_UPDATES_AVAILABLE", async () => {
    syncTriggeredWith = null;

    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: plaidItemId,
      }),
    });

    const resp = await plaidWebhookPost(req);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(body.success).toBe(true);

    expect(syncTriggeredWith).not.toBeNull();
    expect(syncTriggeredWith.id).toBe(itemDbId);
    expect(syncTriggeredWith.plaid_item_id).toBe(plaidItemId);
  });

  it("does not trigger sync and returns 200 for unrecognized item_id", async () => {
    syncTriggeredWith = null;

    const req = new NextRequest("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "non-existent-item-id",
      }),
    });

    const resp = await plaidWebhookPost(req);
    expect(resp.status).toBe(200);
    expect(syncTriggeredWith).toBeNull();
  });
});
