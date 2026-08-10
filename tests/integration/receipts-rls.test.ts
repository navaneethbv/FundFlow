import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cross-user isolation for Phase C1 receipts, over BOTH halves of the feature:
 * the `public.receipts` row and the object in the private `receipts` bucket.
 *
 * Receipts are the first surface where a user uploads an image of a real
 * purchase, so a leak here exposes more than a row — it exposes a picture. The
 * migration `20260809192302_secure_receipts_server_writes.sql` narrowed this to
 * owner-only select with no client write path at all, and dropped the storage
 * policy so objects are reachable only through a server-minted signed URL.
 * Both of those are asserted here rather than assumed.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);

const suite = run ? describe : describe.skip;

suite("receipts RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const userA = { email: `receipts-a-${stamp}@example.com`, password: "Password123!" };
  const userB = { email: `receipts-b-${stamp}@example.com`, password: "Password123!" };

  let idA = "";
  let idB = "";
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let receiptId = "";
  let storagePath = "";

  async function makeUser(email: string, password: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return data.user.id;
  }

  async function signIn(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    idA = await makeUser(userA.email, userA.password);
    idB = await makeUser(userB.email, userB.password);
    clientA = await signIn(userA.email, userA.password);
    clientB = await signIn(userB.email, userB.password);

    // Seed as the service client, which is the only writer the app has.
    storagePath = `${idA}/${stamp}-receipt.png`;
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = await admin.storage
      .from("receipts")
      .upload(storagePath, pixel, { contentType: "image/png", upsert: true });
    if (upload.error) throw upload.error;

    const { data, error } = await admin
      .from("receipts")
      .insert({
        user_id: idA,
        storage_path: storagePath,
        merchant: "Test Cafe",
        purchase_date: "2026-08-09",
        total: 12.34,
        status: "unmatched",
      })
      .select("id")
      .single();
    if (error) throw error;
    receiptId = data.id as string;
  });

  afterAll(async () => {
    if (storagePath) await admin.storage.from("receipts").remove([storagePath]);
    if (receiptId) await admin.from("receipts").delete().eq("id", receiptId);
    if (idA) await admin.auth.admin.deleteUser(idA);
    if (idB) await admin.auth.admin.deleteUser(idB);
  });

  it("lets the owner read their own receipt row", async () => {
    const { data, error } = await clientA
      .from("receipts")
      .select("id, merchant")
      .eq("id", receiptId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.merchant).toBe("Test Cafe");
  });

  it("hides the row from another signed-in user", async () => {
    const { data, error } = await clientB
      .from("receipts")
      .select("id")
      .eq("id", receiptId);

    // RLS filters rather than errors: the correct outcome is zero rows.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("gives no client a write path, not even the owner", async () => {
    const insert = await clientA.from("receipts").insert({
      user_id: idA,
      storage_path: `${idA}/forged.png`,
      status: "unmatched",
    });
    expect(insert.error).not.toBeNull();

    const update = await clientA
      .from("receipts")
      .update({ merchant: "Rewritten" })
      .eq("id", receiptId);
    expect(update.error).not.toBeNull();

    const remove = await clientA.from("receipts").delete().eq("id", receiptId);
    expect(remove.error).not.toBeNull();

    // The row survived all three attempts unchanged.
    const { data } = await admin
      .from("receipts")
      .select("merchant")
      .eq("id", receiptId)
      .single();
    expect(data?.merchant).toBe("Test Cafe");
  });

  it("refuses another user's attempt to insert a row under the owner's id", async () => {
    const { error } = await clientB.from("receipts").insert({
      user_id: idA,
      storage_path: `${idA}/planted.png`,
      status: "unmatched",
    });
    expect(error).not.toBeNull();
  });

  it("keeps the stored object unreachable from the browser client", async () => {
    // The bucket is private and its client policy was dropped, so neither the
    // other user nor the owner can pull the object directly — a signed URL
    // minted server-side is the only route to the image.
    const asOther = await clientB.storage.from("receipts").download(storagePath);
    expect(asOther.error).not.toBeNull();

    const asOwner = await clientA.storage.from("receipts").download(storagePath);
    expect(asOwner.error).not.toBeNull();

    const forged = await clientB.storage.from("receipts").createSignedUrl(storagePath, 60);
    expect(forged.error).not.toBeNull();
  });

  it("serves the object through a server-minted signed URL", async () => {
    const { data, error } = await admin.storage
      .from("receipts")
      .createSignedUrl(storagePath, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();

    const response = await fetch(data!.signedUrl);
    expect(response.status).toBe(200);
  });
});
