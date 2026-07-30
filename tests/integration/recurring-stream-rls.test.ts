import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

suite("recurring stream transactions RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const credentials = {
    owner: { email: `rst-owner-${stamp}@example.com`, password: "Password123!" },
    member: { email: `rst-member-${stamp}@example.com`, password: "Password123!" },
    outsider: { email: `rst-outsider-${stamp}@example.com`, password: "Password123!" },
  };
  let ownerId = "";
  let memberId = "";
  let outsiderId = "";
  let privateJoinId = "";
  let sharedJoinId = "";
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let outsiderClient: SupabaseClient;

  async function createUser(email: string, password: string) {
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

  async function insertOne(table: string, value: Record<string, unknown>, columns = "id") {
    const { data, error } = await admin.from(table).insert(value).select(columns).single();
    if (error) throw error;
    return data as unknown as Record<string, unknown>;
  }

  beforeAll(async () => {
    ownerId = await createUser(credentials.owner.email, credentials.owner.password);
    memberId = await createUser(credentials.member.email, credentials.member.password);
    outsiderId = await createUser(credentials.outsider.email, credentials.outsider.password);
    ownerClient = await signIn(credentials.owner.email, credentials.owner.password);
    memberClient = await signIn(credentials.member.email, credentials.member.password);
    outsiderClient = await signIn(credentials.outsider.email, credentials.outsider.password);

    const household = await insertOne("households", {
      owner_user_id: ownerId,
      name: "Recurring RLS household",
    });
    await insertOne("household_members", {
      household_id: household.id,
      user_id: memberId,
      role: "member",
      status: "active",
    });

    const privateItem = await insertOne("plaid_items", {
      user_id: ownerId,
      plaid_item_id: `item-private-${stamp}`,
      access_token_ciphertext: "x",
      access_token_iv: "x",
      access_token_tag: "x",
    });
    const sharedItem = await insertOne("plaid_items", {
      user_id: ownerId,
      plaid_item_id: `item-shared-${stamp}`,
      access_token_ciphertext: "x",
      access_token_iv: "x",
      access_token_tag: "x",
      shared_household_id: household.id,
    });

    const privateAccount = await insertOne("accounts", {
      user_id: ownerId,
      plaid_item_id: privateItem.id,
      plaid_account_id: `acc-private-${stamp}`,
      name: "Private checking",
      type: "depository",
    });
    const sharedAccount = await insertOne("accounts", {
      user_id: ownerId,
      plaid_item_id: sharedItem.id,
      plaid_account_id: `acc-shared-${stamp}`,
      name: "Shared checking",
      type: "depository",
    });

    const privateTxn = await insertOne("transactions", {
      user_id: ownerId,
      account_id: privateAccount.id,
      plaid_transaction_id: `txn-private-${stamp}`,
      date: "2026-07-01",
      amount: 12.99,
      name: "PRIVATE SUB",
    });
    const sharedTxn = await insertOne("transactions", {
      user_id: ownerId,
      account_id: sharedAccount.id,
      plaid_transaction_id: `txn-shared-${stamp}`,
      date: "2026-07-01",
      amount: 12.99,
      name: "SHARED SUB",
    });

    const privateStream = await insertOne("recurring_streams", {
      user_id: ownerId,
      plaid_item_id: privateItem.id,
      stream_id: `stream-private-${stamp}`,
      status: "MATURE",
    });
    const sharedStream = await insertOne("recurring_streams", {
      user_id: ownerId,
      plaid_item_id: sharedItem.id,
      stream_id: `stream-shared-${stamp}`,
      status: "MATURE",
    });

    const privateJoin = await insertOne("recurring_stream_transactions", {
      user_id: ownerId,
      recurring_stream_id: privateStream.id,
      transaction_id: privateTxn.id,
    });
    const sharedJoin = await insertOne("recurring_stream_transactions", {
      user_id: ownerId,
      recurring_stream_id: sharedStream.id,
      transaction_id: sharedTxn.id,
    });
    privateJoinId = privateJoin.id as string;
    sharedJoinId = sharedJoin.id as string;
  });

  afterAll(async () => {
    for (const id of [ownerId, memberId, outsiderId]) {
      if (id) await admin.auth.admin.deleteUser(id);
    }
  });

  it("lets the owner read both join rows", async () => {
    const { data, error } = await ownerClient
      .from("recurring_stream_transactions")
      .select("id")
      .in("id", [privateJoinId, sharedJoinId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id).sort()).toEqual(
      [privateJoinId, sharedJoinId].sort(),
    );
  });

  it("lets a household member read only the shared join row", async () => {
    const { data, error } = await memberClient
      .from("recurring_stream_transactions")
      .select("id")
      .in("id", [privateJoinId, sharedJoinId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([sharedJoinId]);
  });

  it("blocks an outsider from reading either join row", async () => {
    const { data, error } = await outsiderClient
      .from("recurring_stream_transactions")
      .select("id")
      .in("id", [privateJoinId, sharedJoinId]);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("denies the cookie client any write", async () => {
    // No UPDATE policy exists on this table, so its implicit USING clause
    // (the one Postgres checks to find rows eligible for UPDATE) matches
    // zero rows for the owner's own row too -- the update silently affects
    // nothing and PostgREST reports no error. Verified empirically against
    // this exact table: an UPDATE here returns { error: null, status: 200 },
    // while an INSERT on the same table (no INSERT policy either) returns
    // { error: { code: "42501", message: "new row violates row-level
    // security policy..." }, status: 403 }. That is the real mechanism --
    // UPDATE's USING clause silently filters, INSERT's WITH CHECK clause
    // hard-fails -- not a difference in table-level GRANTs between this
    // table and its siblings. (An earlier version of this comment blamed a
    // missing INSERT/UPDATE/DELETE grant for the silent no-op; that GRANT
    // theory doesn't hold here either -- the UPDATE reaches RLS at all,
    // meaning the role already has UPDATE privilege on this table, most
    // likely via Supabase's default per-schema grants to `authenticated`
    // rather than this migration's explicit `grant select`.) This is why
    // tests/integration/account-snapshot-rls.test.ts's "denies authenticated
    // snapshot writes" test (an INSERT) can assert directly on `error`, while
    // an UPDATE-based test here cannot -- it's the command type, not the
    // table, that decides. tests/integration/budget-period-rls.test.ts's
    // household-write-denial case hits the same UPDATE-silently-filters path
    // and is the correct precedent for verifying via the admin client that
    // the row is unchanged instead of asserting on `error`.
    const before = await admin
      .from("recurring_stream_transactions")
      .select("created_at")
      .eq("id", privateJoinId)
      .single();
    expect(before.error).toBeNull();

    await ownerClient
      .from("recurring_stream_transactions")
      .update({ created_at: new Date(0).toISOString() })
      .eq("id", privateJoinId);

    const { data: unchanged, error } = await admin
      .from("recurring_stream_transactions")
      .select("created_at")
      .eq("id", privateJoinId)
      .single();
    expect(error).toBeNull();
    expect(unchanged?.created_at).toEqual(before.data?.created_at);
  });
});
