import { describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

let investmentsEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => investmentsEnabled,
}));

import {
  collectReceiptAssets,
  collectUserData,
  countUserDataRows,
  countUserRecordRows,
  RECEIPT_ASSET_BUDGET_BYTES,
  USER_DATA_TABLES,
  type UserDataTableSpec,
} from "@/lib/user-data";

describe("lib/user-data", () => {
  it("uses columns that exist for the latest backup tables", () => {
    const spec = (key: string) => USER_DATA_TABLES.find((table) => table.key === key)!;
    expect(spec("account_preferences")).toMatchObject({
      table: "profiles",
      scope: "profile",
      select: "dashboard_prefs",
    });
    expect(spec("credit_card_bills").select).toContain("statement_balance");
    expect(spec("credit_card_bills").select).not.toMatch(/(^|, )balance(,|$)/);
    expect(spec("life_events").select).toContain("start_month");
    expect(spec("life_events").select).not.toContain("target_date");
    expect(spec("alert_preferences").orderBySecondary).toBeNull();
    expect(spec("ai_settings").orderBySecondary).toBeNull();
  });

  it("carries the annotation columns a restore needs to reproduce the ledger (FF-09)", () => {
    const annotations = USER_DATA_TABLES.find((t) => t.key === "transaction_annotations")!;
    for (const column of ["display_category", "cash_flow_classification", "cleared_at"]) {
      expect(annotations.select).toContain(column);
    }
  });

  it("carries the provider keys an account reinsert requires (FF-09)", () => {
    // accounts.plaid_account_id and plaid_item_id are NOT NULL; without them a
    // restore cannot write the row back at all.
    const accounts = USER_DATA_TABLES.find((t) => t.key === "accounts")!;
    expect(accounts.restoreKeys).toContain("plaid_account_id");
    expect(accounts.restoreKeys).toContain("plaid_item_id");
    // They stay out of the takeout, whose contract excludes identifiers.
    expect(accounts.select).not.toContain("plaid_account_id");
  });

  it("collects every user-owned section scoped to the caller", async () => {
    const supabase = clientStub({
      accounts: { data: [{ name: "Checking" }] },
      shared_expenses: { data: [{ description: "Dinner" }] },
      households: { data: [{ name: "Home" }] },
    });

    const sections = await collectUserData(supabase as never, "u1");

    expect(sections.accounts).toEqual([{ name: "Checking" }]);
    expect(sections.shared_expenses).toEqual([{ description: "Dinner" }]);
    expect(sections.households).toEqual([{ name: "Home" }]);
    expect(supabase.scopedToUser("accounts", "u1")).toBe(true);
    expect(supabase.scopedToUser("transactions", "u1")).toBe(true);
    expect(supabase.scopedToUser("households", "u1")).toBe(false);
    expect(supabase.callsOn("profiles")).toContainEqual(
      expect.objectContaining({ method: "eq", args: ["id", "u1"] }),
    );
  });

  it("scopes households by owner and shared expenses by involvement", async () => {
    const supabase = clientStub();

    await collectUserData(supabase as never, "u1");

    const households = supabase.callsOn("households");
    expect(households).toContainEqual(
      expect.objectContaining({ method: "eq", args: ["owner_user_id", "u1"] }),
    );
    const shared = supabase.callsOn("shared_expenses");
    expect(shared).toContainEqual(
      expect.objectContaining({
        method: "or",
        args: ["paid_by.eq.u1,owed_user_id.eq.u1"],
      }),
    );
  });

  it("skips investment tables when the feature is off", async () => {
    investmentsEnabled = false;
    const supabase = clientStub();

    const sections = await collectUserData(supabase as never, "u1");

    expect(sections.holdings).toEqual([]);
    expect(sections.holding_snapshots).toEqual([]);
    expect(sections.securities).toEqual([]);
    expect(sections.investment_transactions).toEqual([]);
    expect(supabase.callsOn("holdings")).toHaveLength(0);
  });

  it("coerces null query data to empty arrays", async () => {
    investmentsEnabled = true;
    const supabase = clientStub({ accounts: { data: null } });

    const sections = await collectUserData(supabase as never, "u1");

    expect(sections.accounts).toEqual([]);
    expect(sections.budgets).toEqual([]);
  });

  it("throws when any owned query errors", async () => {
    investmentsEnabled = true;
    const supabase = clientStub({
      budgets: { error: { message: "select failed" } },
    });

    await expect(collectUserData(supabase as never, "u1")).rejects.toThrow(
      "select failed",
    );
  });

  it("paginates tables with more than 1,000 rows across multiple pages", async () => {
    investmentsEnabled = false;
    const manyAccounts = Array.from({ length: 1005 }, (_, i) => ({ id: `acc-${i}`, name: `Account ${i}` }));
    const supabase = clientStub({
      accounts: { data: manyAccounts },
    });

    const sections = await collectUserData(supabase as never, "u1");
    expect(sections.accounts).toHaveLength(1005);
  });

  it("counts rows across every section", () => {
    expect(
      countUserDataRows({
        accounts: [{ id: 1 }],
        budgets: [],
        transactions: [{ id: 2 }, { id: 3 }],
      }),
    ).toBe(3);
  });
});

describe("collectReceiptAssets", () => {
  function bucketClient(
    files: Record<string, { bytes: Uint8Array; type?: string } | "error">,
  ) {
    return {
      storage: {
        from: () => ({
          download: async (path: string) => {
            const entry = files[path];
            if (!entry || entry === "error") return { data: null, error: { message: "gone" } };
            return {
              data: {
                type: entry.type ?? "image/jpeg",
                arrayBuffer: async () => entry.bytes.buffer,
              } as unknown as Blob,
              error: null,
            };
          },
        }),
      },
    };
  }

  it("downloads each receipt image as base64 beside its metadata row", async () => {
    const client = bucketClient({
      "u1/a.jpg": { bytes: new Uint8Array([104, 105]), type: "image/png" },
    });

    const result = await collectReceiptAssets(client, [{ storage_path: "u1/a.jpg" }]);

    expect(result.assets).toEqual([
      { storage_path: "u1/a.jpg", content_type: "image/png", data_base64: "aGk=" },
    ]);
    expect(result.omitted).toEqual([]);
  });

  it("names what the byte budget forced it to leave out instead of dropping it silently", async () => {
    const client = bucketClient({
      "u1/a.jpg": { bytes: new Uint8Array(10) },
      "u1/b.jpg": { bytes: new Uint8Array(10) },
    });

    const result = await collectReceiptAssets(
      client,
      [{ storage_path: "u1/a.jpg" }, { storage_path: "u1/b.jpg" }],
      12,
    );

    expect(result.assets).toHaveLength(1);
    expect(result.omitted).toEqual([{ storage_path: "u1/b.jpg", reason: "budget_exceeded" }]);
  });

  it("records a failed download rather than aborting the backup", async () => {
    const client = bucketClient({ "u1/a.jpg": "error" });

    const result = await collectReceiptAssets(client, [{ storage_path: "u1/a.jpg" }]);

    expect(result.assets).toEqual([]);
    expect(result.omitted).toEqual([{ storage_path: "u1/a.jpg", reason: "download_failed" }]);
  });

  it("ignores rows with no usable storage path", async () => {
    const client = bucketClient({});

    const result = await collectReceiptAssets(client, [
      { storage_path: null },
      { storage_path: "" },
      null,
    ]);

    expect(result).toEqual({ assets: [], omitted: [] });
  });

  it("stops downloading once the budget is already spent", async () => {
    const client = bucketClient({
      "u1/a.jpg": { bytes: new Uint8Array(12) },
      "u1/b.jpg": { bytes: new Uint8Array(1) },
      "u1/c.jpg": { bytes: new Uint8Array(1) },
    });

    const result = await collectReceiptAssets(
      client,
      [{ storage_path: "u1/a.jpg" }, { storage_path: "u1/b.jpg" }, { storage_path: "u1/c.jpg" }],
      12,
    );

    // The first fills the budget exactly; the rest are refused without a
    // download attempt.
    expect(result.assets).toHaveLength(1);
    expect(result.omitted.map((entry) => entry.storage_path)).toEqual([
      "u1/b.jpg",
      "u1/c.jpg",
    ]);
  });

  it("records a download that resolves without a blob as missing", async () => {
    const client = {
      storage: {
        from: () => ({ download: async () => ({ data: null, error: null }) }),
      },
    };

    const result = await collectReceiptAssets(client, [{ storage_path: "u1/a.jpg" }]);

    expect(result.omitted).toEqual([{ storage_path: "u1/a.jpg", reason: "download_failed" }]);
  });

  it("falls back to a generic content type when the blob reports none", async () => {
    const client = bucketClient({ "u1/a.jpg": { bytes: new Uint8Array([104]), type: "" } });

    const result = await collectReceiptAssets(client, [{ storage_path: "u1/a.jpg" }]);

    expect(result.assets[0]!.content_type).toBe("application/octet-stream");
  });

  it("keeps the default budget inside what an email attachment can carry", () => {
    expect(RECEIPT_ASSET_BUDGET_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  it("defaults primary and secondary order when omitted from spec", async () => {
    const supabase = clientStub({ test_table: { data: [{ id: "1" }] } });
    const spec: UserDataTableSpec = {
      key: "test_spec",
      table: "test_table",
      select: "id",
      scope: "user",
      orderBy: undefined,
      orderBySecondary: undefined,
    };
    USER_DATA_TABLES.push(spec);
    try {
      const data = await collectUserData(supabase as never, "u1");
      expect(data.test_spec).toEqual([{ id: "1" }]);
    } finally {
      USER_DATA_TABLES.pop();
    }
  });

  it("appends restoreKeys when includeRestoreKeys option is true", async () => {
    const supabase = clientStub({
      accounts: { data: [{ name: "Checking", id: "acc-1" }] },
    });
    const data = await collectUserData(supabase as never, "u1", {
      includeRestoreKeys: true,
    });
    expect(data.accounts).toEqual([{ name: "Checking", id: "acc-1" }]);
    const selectCall = supabase.callsOn("accounts").find((c) => c.method === "select");
    expect(selectCall?.args[0]).toContain("plaid_account_id");
  });

  it("counts user record rows excluding preferences sections", () => {
    const count = countUserRecordRows({
      accounts: [{ id: "1" }, { id: "2" }],
      account_preferences: [{ id: "p1" }],
      ai_settings: [{ enabled: true }],
      alert_preferences: [{ id: "a1" }],
      budgets: [{ id: "b1" }],
    });
    // accounts (2) + budgets (1) = 3; account_preferences, ai_settings, alert_preferences excluded
    expect(count).toBe(3);
  });
});


describe("transaction review archive compatibility", () => {
  it("omits only an absent review relation while the feature is off", async () => {
    investmentsEnabled = false;
    for (const code of ["42P01", "PGRST205"]) {
      const client = clientStub({ transaction_review_states: { error: { code } } });
      const result = await collectUserData(client as never, "owner");
      expect(result.transaction_review_states).toEqual([]);
    }
  });
  it("keeps more than one page of owner review records during a UI rollback", async () => {
    investmentsEnabled = false;
    const rows = Array.from({ length: 1205 }, (_, i) => ({ transaction_id: String(i), status: "reviewed", version: "9007199254740993" }));
    const client = clientStub({ transaction_review_states: { data: rows } });
    const result = await collectUserData(client as never, "owner");
    expect(result.transaction_review_states).toEqual(rows);
    expect(client.scopedToUser("transaction_review_states", "owner")).toBe(true);
    expect(client.callsOn("transaction_review_states").filter((call) => call.method === "order").every((call) => call.args[0] === "transaction_id")).toBe(true);
  });
  it("does not mask missing schema when enabled, permission errors, or unrelated failures", async () => {
    investmentsEnabled = true;
    let error = { code: "42P01" };
    await expect(collectUserData(clientStub({ transaction_review_states: { error } }) as never, "owner")).rejects.toEqual(error);
    investmentsEnabled = false;
    error = { code: "42501" };
    await expect(collectUserData(clientStub({ transaction_review_states: { error } }) as never, "owner")).rejects.toEqual(error);
    error = { code: "42P01" };
    await expect(collectUserData(clientStub({ transactions: { error } }) as never, "owner")).rejects.toEqual(error);
    investmentsEnabled = true;
  });
});
