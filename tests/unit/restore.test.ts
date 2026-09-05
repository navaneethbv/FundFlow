import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRestorePlan,
  executeRestore,
  RestoreValidationError,
} from "@/lib/restore";

const ARCHIVE = {
  accounts: [{ id: "acc-1", name: "Checking", plaid_account_id: "plaid-acc-1", plaid_item_id: "item-1" }],
  transactions: [
    { id: "t1", plaid_transaction_id: "plaid-1", amount: 100, date: "2026-08-01" },
  ],
  shared_expenses: [{ description: "dinner", amount: 40 }],
  budgets: [{ id: "b1", category: "rent", monthly_limit: 1500 }],
} as Record<string, unknown[]>;

describe("buildRestorePlan", () => {
  it("plans every archive section present in the registry", () => {
    const plan = buildRestorePlan(ARCHIVE);
    const names = plan.tables.map((table) => table.name);
    expect(names).toContain("accounts");
    expect(names).toContain("transactions");
    expect(names).toContain("shared_expenses");
    const accounts = plan.tables.find((table) => table.name === "accounts")!;
    expect(accounts.rowCount).toBe(1);
    expect(accounts.columns).toContain("name");
    expect(plan.totalRows).toBe(4);
  });

  it("reports registry tables missing from the archive", () => {
    const plan = buildRestorePlan(ARCHIVE);
    expect(plan.missingTables).toContain("goals");
    expect(plan.missingTables).not.toContain("accounts");
  });

  it("collects unknown sections and excludes them from tables", () => {
    const plan = buildRestorePlan({ ...ARCHIVE, future_table: [{ x: 1 }] });
    expect(plan.unknownKeys).toEqual(["future_table"]);
    expect(plan.tables.map((table) => table.name)).not.toContain("future_table");
  });

  it("rejects non-object payloads with a typed error", () => {
    expect(() => buildRestorePlan(null)).toThrow(RestoreValidationError);
    expect(() => buildRestorePlan([1, 2])).toThrow(RestoreValidationError);
    expect(() => buildRestorePlan("garbage")).toThrow(RestoreValidationError);
  });

  it("rejects a section that is not a row list", () => {
    expect(() => buildRestorePlan({ accounts: "corrupt" })).toThrow(RestoreValidationError);
  });
});

const BUILDER_METHODS = ["delete", "eq", "insert", "select", "update", "upsert"] as const;

/** Every archived account belongs to this still-linked Plaid item by default. */
const LINKED_ITEM_ID = "item-1";

function serviceStub(
  tableData: Record<string, unknown[]> = { plaid_items: [{ id: LINKED_ITEM_ID }] },
) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const uploads: Array<{ path: string; options: unknown }> = [];
  let failOn: string | null = null;
  let uploadError: string | null = null;

  const buildFor = (table: string): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const make = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return buildFor(table);
    };
    for (const method of BUILDER_METHODS) builder[method] = make(method);
    builder.then = (resolve: (value: unknown) => unknown) =>
      resolve({
        data: tableData[table] ?? null,
        error: failOn === table ? { message: "boom" } : null,
      });
    return builder;
  };

  const service = {
    from: (table: string) => buildFor(table),
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, options: unknown) => {
          uploads.push({ path, options });
          return { error: uploadError ? { message: uploadError } : null };
        },
      }),
    },
  };
  return {
    service,
    calls,
    uploads,
    setFailOn: (table: string | null) => { failOn = table; },
    setUploadError: (message: string | null) => { uploadError = message; },
  };
}

describe("executeRestore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delete-then-inserts user tables with user_id stamped, restoring parents first", async () => {
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(service as never, "user-123", plan, ARCHIVE);
    expect(result.failedTable).toBeNull();

    const opIdx = (table: string, op: string) =>
      calls.findIndex((call) => call.table === table && call.op === op);
    // accounts (parent) written before transactions (child).
    expect(opIdx("accounts", "upsert")).toBeLessThan(opIdx("transactions", "upsert"));

    const accountUpsert = calls.find(
      (call) => call.table === "accounts" && call.op === "upsert",
    )!;
    expect((accountUpsert.args[0] as Array<Record<string, unknown>>)[0]!.user_id).toBe("user-123");

    const deletes = calls.filter((call) => call.op === "delete");
    for (const del of deletes) {
      expect(del.args).toBeDefined();
    }
    expect(deletes.length).toBeGreaterThan(0);
  });

  it("never deletes accounts before reinserting them, which would cascade the ledger away (FF-09)", async () => {
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);

    const result = await executeRestore(service as never, "user-123", plan, ARCHIVE);

    expect(result.failedTable).toBeNull();
    expect(calls.some((call) => call.table === "accounts" && call.op === "delete")).toBe(false);
    const upsert = calls.find((call) => call.table === "accounts" && call.op === "upsert")!;
    expect(upsert.args[1]).toEqual({ onConflict: "plaid_account_id" });
    // The provider keys a reinsert needs are carried through, not stripped.
    const row = (upsert.args[0] as Array<Record<string, unknown>>)[0]!;
    expect(row.plaid_account_id).toBe("plaid-acc-1");
    expect(row.plaid_item_id).toBe("item-1");
  });

  it("upserts manual_accounts on id rather than deleting the FK parent", async () => {
    const archive = { manual_accounts: [{ id: "m1", name: "Cash" }] } as Record<string, unknown[]>;
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(archive);

    await executeRestore(service as never, "user-123", plan, archive);

    expect(calls.some((call) => call.table === "manual_accounts" && call.op === "delete")).toBe(false);
    const upsert = calls.find((call) => call.table === "manual_accounts" && call.op === "upsert")!;
    expect(upsert.args[1]).toEqual({ onConflict: "id" });
  });

  it("reports accounts whose Plaid item is gone instead of failing or dropping them", async () => {
    // Arrange: the archive's account points at an item the user has unlinked.
    const { service, calls } = serviceStub({ plaid_items: [] });
    const plan = buildRestorePlan(ARCHIVE);

    // Act
    const result = await executeRestore(service as never, "user-123", plan, ARCHIVE);

    // Assert: the run completes and says what it could not restore.
    expect(result.failedTable).toBeNull();
    expect(result.skipped).toContainEqual({
      name: "accounts (unlinked banks)",
      reason:
        "1 account belongs to a Plaid connection this account no longer has; relink the bank, then restore again",
    });
    // Nothing was restorable, so nothing is written at all.
    expect(calls.some((call) => call.table === "accounts" && call.op === "upsert")).toBe(false);
    expect(result.tables).toContainEqual({ name: "accounts", rowsWritten: 0 });
  });

  it("writes archived receipt images back into storage and counts what was missing", async () => {
    const archive = {
      receipts: [{ id: "r1", storage_path: "user-123/r1.jpg" }],
      receipt_assets: [
        { storage_path: "user-123/r1.jpg", content_type: "image/jpeg", data_base64: "aGk=" },
      ],
      receipt_assets_omitted: [{ storage_path: "user-123/r2.jpg", reason: "budget_exceeded" }],
    } as Record<string, unknown[]>;
    const { service, uploads } = serviceStub();
    const plan = buildRestorePlan(archive);

    const result = await executeRestore(service as never, "user-123", plan, archive);

    expect(uploads).toEqual([
      { path: "user-123/r1.jpg", options: { contentType: "image/jpeg", upsert: true } },
    ]);
    expect(result.receiptAssetsRestored).toBe(1);
    // The one the backup could not carry is still reported to the user.
    expect(result.receiptAssetsMissing).toBe(1);
  });

  it("counts a failed image upload as missing rather than failing the restore", async () => {
    const archive = {
      receipt_assets: [
        { storage_path: "user-123/r1.jpg", content_type: "image/jpeg", data_base64: "aGk=" },
      ],
    } as Record<string, unknown[]>;
    const { service, setUploadError } = serviceStub();
    setUploadError("storage down");
    const plan = buildRestorePlan(archive);

    const result = await executeRestore(service as never, "user-123", plan, archive);

    expect(result.failedTable).toBeNull();
    expect(result.receiptAssetsRestored).toBe(0);
    expect(result.receiptAssetsMissing).toBe(1);
  });

  it("reports the failing parent table when an accounts upsert errors", async () => {
    const { service, setFailOn } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    setFailOn("accounts");

    const result = await executeRestore(service as never, "user-123", plan, ARCHIVE);

    expect(result.failedTable).toBe("accounts");
  });

  it("reports the failing parent table when a manual_accounts upsert errors", async () => {
    const archive = { manual_accounts: [{ id: "m1" }] } as Record<string, unknown[]>;
    const { service, setFailOn } = serviceStub();
    const plan = buildRestorePlan(archive);
    setFailOn("manual_accounts");

    const result = await executeRestore(service as never, "user-123", plan, archive);

    expect(result.failedTable).toBe("manual_accounts");
  });

  it("fails the accounts table when the plaid_items lookup itself errors", async () => {
    const { service, setFailOn } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    setFailOn("plaid_items");

    const result = await executeRestore(service as never, "user-123", plan, ARCHIVE);

    // A lookup that never ran must not be read as "no items exist".
    expect(result.failedTable).toBe("accounts");
  });

  it("pluralises the unlinked-bank report for more than one account", async () => {
    const archive = {
      accounts: [
        { id: "a1", plaid_account_id: "p1", plaid_item_id: "gone" },
        { id: "a2", plaid_account_id: "p2", plaid_item_id: "gone" },
      ],
    } as Record<string, unknown[]>;
    const { service } = serviceStub({ plaid_items: [] });
    const plan = buildRestorePlan(archive);

    const result = await executeRestore(service as never, "user-123", plan, archive);

    expect(result.skipped[0]!.reason).toMatch(/^2 accounts belong/);
  });

  it("stamps user_id onto a non-object parent row instead of writing it through", async () => {
    const archive = { manual_accounts: ["not an object"] } as unknown as Record<string, unknown[]>;
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(archive);

    await executeRestore(service as never, "user-123", plan, archive);

    const upsert = calls.find((call) => call.table === "manual_accounts" && call.op === "upsert")!;
    expect(upsert.args[0]).toEqual([{ user_id: "user-123" }]);
  });

  it("counts a malformed receipt asset as missing rather than uploading garbage", async () => {
    const archive = {
      receipt_assets: [
        { storage_path: 42, data_base64: "aGk=" },
        { storage_path: "u/1.jpg" },
        null,
      ],
    } as unknown as Record<string, unknown[]>;
    const { service, uploads } = serviceStub();
    const plan = buildRestorePlan(archive);

    const result = await executeRestore(service as never, "user-123", plan, archive);

    expect(uploads).toEqual([]);
    expect(result.receiptAssetsMissing).toBe(3);
  });

  it("falls back to a generic content type when the archive did not record one", async () => {
    const archive = {
      receipt_assets: [{ storage_path: "u/1.bin", data_base64: "aGk=" }],
    } as Record<string, unknown[]>;
    const { service, uploads } = serviceStub();
    const plan = buildRestorePlan(archive);

    await executeRestore(service as never, "user-123", plan, archive);

    expect(uploads[0]!.options).toEqual({
      contentType: "application/octet-stream",
      upsert: true,
    });
  });

  it("does not report the receipt asset sections as unknown archive keys", () => {
    const plan = buildRestorePlan({
      receipt_assets: [],
      receipt_assets_omitted: [],
      future_table: [{ x: 1 }],
    });
    expect(plan.unknownKeys).toEqual(["future_table"]);
    expect(plan.tables.map((t) => t.name)).not.toContain("receipt_assets");
  });

  it("skips shared/owner-scope tables instead of deleting other people's rows", async () => {
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(service as never, "user-123", plan, ARCHIVE);
    expect(result.skipped).toEqual([
      { name: "shared_expenses", reason: "involves other users' rows; not restorable in-app" },
    ]);
    expect(calls.some((call) => call.table === "shared_expenses")).toBe(false);
  });

  it("upserts transactions on plaid_transaction_id without a delete", async () => {
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(service as never, "user-123", plan, ARCHIVE);
    const upsert = calls.find((call) => call.table === "transactions" && call.op === "upsert")!;
    expect(upsert).toBeDefined();
    expect(calls.some((call) => call.table === "transactions" && call.op === "delete")).toBe(false);
    const rows = upsert.args[0] as Array<Record<string, unknown>>;
    expect(rows[0]!.plaid_transaction_id).toBe("plaid-1");
    expect(result.regeneratedIds).toBe(0);
  });

  it("regenerates provenance ids for archive rows without a plaid id", async () => {
    const { service } = serviceStub();
    const archive = {
      transactions: [{ amount: 5, date: "2026-08-02" }],
    };
    const plan = buildRestorePlan(archive);
    const result = await executeRestore(service as never, "user-123", plan, archive);
    expect(result.regeneratedIds).toBe(1);
  });

  it("reports the failed table instead of throwing", async () => {
    const stubControl = serviceStub();
    stubControl.setFailOn("transactions");
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(stubControl.service as never, "user-123", plan, ARCHIVE);
    expect(result.failedTable).toBe("transactions");
  });
});

describe("executeRestore — chunking and failure branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("regenerates ids for null rows too", async () => {
    const { service } = serviceStub();
    const archive = { transactions: [null, { amount: 5, date: "2026-08-02" }] };
    const plan = buildRestorePlan(archive);
    const result = await executeRestore(service as never, "user-123", plan, archive);
    expect(result.regeneratedIds).toBe(2);
  });

  it("reports a delete failure by table name", async () => {
    const control = serviceStub();
    const baseFrom = control.service.from as unknown as (table: string) => unknown;
    const failing = {
      from: vi.fn((table: string) => {
        if (table === "budgets") {
          return {
            delete: () => ({
              eq: () => Promise.resolve({ data: null, error: { message: "boom" } }),
            }),
          };
        }
        return baseFrom(table);
      }),
    };
    const archive = { budgets: [{ id: "b1", category: "rent" }] };
    const plan = buildRestorePlan(archive);
    const result = await executeRestore(failing as never, "user-123", plan, archive);
    expect(result.failedTable).toBe("budgets");
  });

  it("reports an insert failure by table name", async () => {
    const control = serviceStub();
    const baseFrom = control.service.from as unknown as (table: string) => unknown;
    const failing = {
      from: vi.fn((table: string) => {
        if (table === "budgets") {
          return {
            delete: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
            insert: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          };
        }
        return baseFrom(table);
      }),
    };
    const archive = { budgets: [{ id: "b1", category: "rent" }] };
    const plan = buildRestorePlan(archive);
    const result = await executeRestore(failing as never, "user-123", plan, archive);
    expect(result.failedTable).toBe("budgets");
  });

  it("chunks large tables across multiple inserts", async () => {
    const control = serviceStub();
    const rows = Array.from({ length: 601 }, (_, index) => ({ id: `b${index}`, category: "x" }));
    const archive = { budgets: rows };
    const plan = buildRestorePlan(archive);
    const result = await executeRestore(control.service as never, "user-123", plan, archive);
    expect(result.tables[0]!.rowsWritten).toBe(601);
    const inserts = control.calls.filter((call) => call.table === "budgets" && call.op === "insert");
    expect(inserts.length).toBeGreaterThanOrEqual(2);
  });

  it("clears tables represented by an empty archive section", async () => {
    const { service, calls } = serviceStub();
    const archive = {
      budgets: [],
    };
    const plan = buildRestorePlan(archive);
    const result = await executeRestore(service as never, "user-123", plan, archive);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]).toEqual({ name: "budgets", rowsWritten: 0 });
    expect(calls.some((call) => call.table === "budgets" && call.op === "delete")).toBe(true);
  });

  it("restores profile preferences through the profiles row", async () => {
    const { service, calls } = serviceStub();
    const archive = {
      account_preferences: [{ dashboard_prefs: { accountsPage: { density: "compact" } } }],
    };
    const plan = buildRestorePlan(archive);
    const result = await executeRestore(service as never, "user-123", plan, archive);
    expect(result.tables).toEqual([{ name: "account_preferences", rowsWritten: 1 }]);
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "profiles",
        op: "update",
        args: [{ dashboard_prefs: { accountsPage: { density: "compact" } } }],
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ table: "profiles", op: "eq", args: ["id", "user-123"] }),
    );
  });

  it("rejects multiple profile preference rows", async () => {
    const { service } = serviceStub();
    const archive = {
      account_preferences: [{ dashboard_prefs: {} }, { dashboard_prefs: {} }],
    };
    const plan = buildRestorePlan(archive);

    const result = await executeRestore(service as never, "user-123", plan, archive);

    expect(result.failedTable).toBe("account_preferences");
  });

  it("rejects malformed profile preference payloads", async () => {
    const { service } = serviceStub();
    const archive = {
      account_preferences: [{ dashboard_prefs: ["invalid"] }],
    };
    const plan = buildRestorePlan(archive);

    const result = await executeRestore(service as never, "user-123", plan, archive);

    expect(result.failedTable).toBe("account_preferences");
  });

  it("handles non-object rows and missing archive sections safely", async () => {
    const { service } = serviceStub();
    const plan1 = buildRestorePlan({ budgets: [{ id: "b1" }] });
    const res1 = await executeRestore(service as never, "user-123", plan1, {});
    expect(res1.tables).toHaveLength(1);

    const archive2 = {
      budgets: [null as unknown as Record<string, unknown>, "primitive" as unknown as Record<string, unknown>],
    };
    const plan2 = buildRestorePlan(archive2);
    const res2 = await executeRestore(service as never, "user-123", plan2, archive2);
    expect(res2.tables).toHaveLength(1);
  });
});
