import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

suite("account balance snapshot RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const ownerCredentials = {
    email: `snapshot-owner-${stamp}@example.com`,
    password: "Password123!",
  };
  const memberCredentials = {
    email: `snapshot-member-${stamp}@example.com`,
    password: "Password123!",
  };

  let ownerId = "";
  let memberId = "";
  let privateSnapshotId = "";
  let sharedSnapshotId = "";
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;

  async function createUser(email: string, password: string): Promise<string> {
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

  async function insertOne(
    table: string,
    value: Record<string, unknown>,
    columns = "id",
  ): Promise<Record<string, unknown>> {
    const { data, error } = await admin
      .from(table)
      .insert(value)
      .select(columns)
      .single();
    if (error) throw error;
    return data as unknown as Record<string, unknown>;
  }

  beforeAll(async () => {
    ownerId = await createUser(ownerCredentials.email, ownerCredentials.password);
    memberId = await createUser(memberCredentials.email, memberCredentials.password);
    ownerClient = await signIn(ownerCredentials.email, ownerCredentials.password);
    memberClient = await signIn(memberCredentials.email, memberCredentials.password);

    const household = await insertOne("households", {
      owner_user_id: ownerId,
      name: "Snapshot RLS household",
    });
    await insertOne("household_members", {
      household_id: household.id,
      user_id: memberId,
      role: "member",
      status: "active",
    });

    const privateItem = await insertOne("plaid_items", {
      user_id: ownerId,
      plaid_item_id: `snapshot-private-item-${stamp}`,
      institution_name: "Private Bank",
      access_token_ciphertext: "ciphertext",
      access_token_iv: "iv",
      access_token_tag: "tag",
    });
    const sharedItem = await insertOne("plaid_items", {
      user_id: ownerId,
      plaid_item_id: `snapshot-shared-item-${stamp}`,
      institution_name: "Shared Bank",
      access_token_ciphertext: "ciphertext",
      access_token_iv: "iv",
      access_token_tag: "tag",
      shared_household_id: household.id,
    });

    const privateAccount = await insertOne("accounts", {
      user_id: ownerId,
      plaid_item_id: privateItem.id,
      plaid_account_id: `snapshot-private-account-${stamp}`,
      name: "Private checking",
      type: "depository",
      current_balance: 100,
      iso_currency_code: "USD",
    });
    const sharedAccount = await insertOne("accounts", {
      user_id: ownerId,
      plaid_item_id: sharedItem.id,
      plaid_account_id: `snapshot-shared-account-${stamp}`,
      name: "Shared checking",
      type: "depository",
      current_balance: 200,
      iso_currency_code: "USD",
    });

    const privateSnapshot = await insertOne("account_balance_snapshots", {
      user_id: ownerId,
      account_id: privateAccount.id,
      snapshot_date: "2026-07-28",
      current_balance: 100,
      iso_currency_code: "USD",
    });
    const sharedSnapshot = await insertOne("account_balance_snapshots", {
      user_id: ownerId,
      account_id: sharedAccount.id,
      snapshot_date: "2026-07-28",
      current_balance: 200,
      iso_currency_code: "USD",
    });
    privateSnapshotId = privateSnapshot.id as string;
    sharedSnapshotId = sharedSnapshot.id as string;
  });

  afterAll(async () => {
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    if (memberId) await admin.auth.admin.deleteUser(memberId);
  });

  it("lets an owner read all of their snapshots", async () => {
    const { data, error } = await ownerClient
      .from("account_balance_snapshots")
      .select("id")
      .in("id", [privateSnapshotId, sharedSnapshotId]);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id).sort()).toEqual(
      [privateSnapshotId, sharedSnapshotId].sort(),
    );
  });

  it("lets a household member read only the shared account snapshot", async () => {
    const { data, error } = await memberClient
      .from("account_balance_snapshots")
      .select("id")
      .in("id", [privateSnapshotId, sharedSnapshotId]);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: sharedSnapshotId }]);
  });

  it("denies authenticated snapshot writes", async () => {
    const { error } = await ownerClient.from("account_balance_snapshots").insert({
      user_id: ownerId,
      account_id: null,
      manual_account_id: crypto.randomUUID(),
      snapshot_date: "2026-07-29",
      current_balance: 1,
      iso_currency_code: "USD",
    });

    expect(error).not.toBeNull();
  });
});
