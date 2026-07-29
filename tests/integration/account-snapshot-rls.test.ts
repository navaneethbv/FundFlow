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
  let privateAccountId = "";
  let sharedAccountId = "";
  let privateSnapshotId = "";
  let sharedSnapshotId = "";
  let privateTransactionId = "";
  let sharedTransactionId = "";
  let privateSplitIds: string[] = [];
  let sharedSplitIds: string[] = [];
  let privateLinkedRefundId = "";
  let sharedLinkedRefundId = "";
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
    privateAccountId = privateAccount.id as string;
    sharedAccountId = sharedAccount.id as string;

    const privateSnapshot = await insertOne("account_balance_snapshots", {
      user_id: ownerId,
      account_id: privateAccountId,
      snapshot_date: "2026-07-28",
      current_balance: 100,
      iso_currency_code: "USD",
    });
    const sharedSnapshot = await insertOne("account_balance_snapshots", {
      user_id: ownerId,
      account_id: sharedAccountId,
      snapshot_date: "2026-07-28",
      current_balance: 200,
      iso_currency_code: "USD",
    });
    privateSnapshotId = privateSnapshot.id as string;
    sharedSnapshotId = sharedSnapshot.id as string;

    const privateTransaction = await insertOne("transactions", {
      user_id: ownerId,
      account_id: privateAccountId,
      plaid_transaction_id: `snapshot-private-transaction-${stamp}`,
      date: "2026-07-28",
      amount: 10,
      name: "PRIVATE TRANSACTION",
      merchant_name: "Private transaction",
      pfc_primary: "GENERAL_MERCHANDISE",
      pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
      pending: false,
    });
    const sharedTransaction = await insertOne("transactions", {
      user_id: ownerId,
      account_id: sharedAccountId,
      plaid_transaction_id: `snapshot-shared-transaction-${stamp}`,
      date: "2026-07-28",
      amount: 20,
      name: "SHARED TRANSACTION",
      merchant_name: "Shared transaction",
      pfc_primary: "GENERAL_MERCHANDISE",
      pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
      pending: false,
    });
    privateTransactionId = privateTransaction.id as string;
    sharedTransactionId = sharedTransaction.id as string;

    const refundTransactions = await Promise.all([
      insertOne("transactions", {
        user_id: ownerId,
        account_id: privateAccountId,
        plaid_transaction_id: `snapshot-private-refund-charge-${stamp}`,
        date: "2026-07-27",
        amount: 15,
        name: "PRIVATE REFUND CHARGE",
        merchant_name: "Private refund",
        pfc_primary: "GENERAL_MERCHANDISE",
        pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      }),
      insertOne("transactions", {
        user_id: ownerId,
        account_id: privateAccountId,
        plaid_transaction_id: `snapshot-private-refund-credit-${stamp}`,
        date: "2026-07-28",
        amount: -15,
        name: "PRIVATE REFUND CREDIT",
        merchant_name: "Private refund",
        pfc_primary: "GENERAL_MERCHANDISE",
        pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      }),
      insertOne("transactions", {
        user_id: ownerId,
        account_id: sharedAccountId,
        plaid_transaction_id: `snapshot-shared-refund-charge-${stamp}`,
        date: "2026-07-27",
        amount: 30,
        name: "SHARED REFUND CHARGE",
        merchant_name: "Shared refund",
        pfc_primary: "GENERAL_MERCHANDISE",
        pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      }),
      insertOne("transactions", {
        user_id: ownerId,
        account_id: sharedAccountId,
        plaid_transaction_id: `snapshot-shared-refund-credit-${stamp}`,
        date: "2026-07-28",
        amount: -30,
        name: "SHARED REFUND CREDIT",
        merchant_name: "Shared refund",
        pfc_primary: "GENERAL_MERCHANDISE",
        pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      }),
    ]);

    const { data: splitRows, error: splitError } = await admin
      .from("transaction_splits")
      .insert([
        {
          user_id: ownerId,
          transaction_id: privateTransactionId,
          category: "Private A",
          amount: 4,
        },
        {
          user_id: ownerId,
          transaction_id: privateTransactionId,
          category: "Private B",
          amount: 6,
        },
        {
          user_id: ownerId,
          transaction_id: sharedTransactionId,
          category: "Shared A",
          amount: 8,
        },
        {
          user_id: ownerId,
          transaction_id: sharedTransactionId,
          category: "Shared B",
          amount: 12,
        },
      ])
      .select("id,transaction_id");
    if (splitError) throw splitError;
    privateSplitIds = splitRows
      .filter((row) => row.transaction_id === privateTransactionId)
      .map((row) => row.id as string);
    sharedSplitIds = splitRows
      .filter((row) => row.transaction_id === sharedTransactionId)
      .map((row) => row.id as string);

    const { data: refundRows, error: refundError } = await admin
      .from("linked_refunds")
      .insert([
        {
          user_id: ownerId,
          charge_transaction_id: refundTransactions[0].id,
          refund_transaction_id: refundTransactions[1].id,
          amount: 15,
        },
        {
          user_id: ownerId,
          charge_transaction_id: refundTransactions[2].id,
          refund_transaction_id: refundTransactions[3].id,
          amount: 30,
        },
      ])
      .select("id,charge_transaction_id");
    if (refundError) throw refundError;
    privateLinkedRefundId = refundRows.find(
      (row) => row.charge_transaction_id === refundTransactions[0].id,
    )!.id as string;
    sharedLinkedRefundId = refundRows.find(
      (row) => row.charge_transaction_id === refundTransactions[2].id,
    )!.id as string;
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
    const { data: accounts, error: accountsError } = await memberClient
      .from("accounts")
      .select("id")
      .in("id", [privateAccountId, sharedAccountId]);
    const { data: items, error: itemsError } = await memberClient
      .from("plaid_items")
      .select("id");
    const { data, error } = await memberClient
      .from("account_balance_snapshots")
      .select("id")
      .in("id", [privateSnapshotId, sharedSnapshotId]);

    expect(accountsError).toBeNull();
    expect(accounts).toEqual([{ id: sharedAccountId }]);
    expect(itemsError).toBeNull();
    expect(items).toEqual([]);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: sharedSnapshotId }]);
  });

  it("lets a household member read only the shared account transaction", async () => {
    const { data, error } = await memberClient
      .from("transactions")
      .select("id")
      .in("id", [privateTransactionId, sharedTransactionId]);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: sharedTransactionId }]);
  });

  it("lets a household member read only projection metadata for shared transactions", async () => {
    const { data: splits, error: splitsError } = await memberClient
      .from("transaction_splits")
      .select("id")
      .in("id", [...privateSplitIds, ...sharedSplitIds]);
    const { data: refunds, error: refundsError } = await memberClient
      .from("linked_refunds")
      .select("id")
      .in("id", [privateLinkedRefundId, sharedLinkedRefundId]);

    expect(splitsError).toBeNull();
    expect(splits?.map((row) => row.id).sort()).toEqual(
      [...sharedSplitIds].sort(),
    );
    expect(refundsError).toBeNull();
    expect(refunds).toEqual([{ id: sharedLinkedRefundId }]);
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

  it("deletes snapshots when their auth user is deleted", async () => {
    const cascadeUserId = await createUser(
      `snapshot-cascade-${stamp}@example.com`,
      "Password123!",
    );

    try {
      const item = await insertOne("plaid_items", {
        user_id: cascadeUserId,
        plaid_item_id: `snapshot-cascade-item-${stamp}`,
        institution_name: "Cascade Bank",
        access_token_ciphertext: "ciphertext",
        access_token_iv: "iv",
        access_token_tag: "tag",
      });
      const account = await insertOne("accounts", {
        user_id: cascadeUserId,
        plaid_item_id: item.id,
        plaid_account_id: `snapshot-cascade-account-${stamp}`,
        name: "Cascade checking",
        type: "depository",
        current_balance: 50,
        iso_currency_code: "USD",
      });
      const manualAccount = await insertOne("manual_accounts", {
        user_id: cascadeUserId,
        name: "Cascade cash",
        account_type: "cash",
        balance: 25,
        include_in_net_worth: true,
      });
      const { data: snapshots, error: snapshotError } = await admin
        .from("account_balance_snapshots")
        .insert([
          {
            user_id: cascadeUserId,
            account_id: account.id,
            snapshot_date: "2026-07-29",
            current_balance: 50,
            iso_currency_code: "USD",
          },
          {
            user_id: cascadeUserId,
            manual_account_id: manualAccount.id,
            snapshot_date: "2026-07-29",
            current_balance: 25,
            iso_currency_code: "USD",
          },
        ])
        .select("id");
      if (snapshotError) throw snapshotError;
      const snapshotIds = (snapshots ?? []).map((snapshot) => snapshot.id);

      const { error: deleteError } =
        await admin.auth.admin.deleteUser(cascadeUserId);
      expect(deleteError).toBeNull();

      const { data, error } = await admin
        .from("account_balance_snapshots")
        .select("id")
        .in("id", snapshotIds);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await admin.auth.admin.deleteUser(cascadeUserId);
    }
  });
});
