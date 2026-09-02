import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRestorePlan,
  executeRestore,
  RestoreValidationError,
} from "@/lib/restore";

const ARCHIVE = {
  accounts: [{ id: "acc-1", name: "Checking" }],
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

function serviceStub() {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  let failOn: string | null = null;
  const service = {
    from: (table: string) => {
      const make = (op: string) => (...args: unknown[]) => {
        calls.push({ table, op, args });
        const builder: Record<string, unknown> = {};
        for (const method of ["delete", "eq", "insert", "upsert"]) {
          builder[method] = make(method);
        }
        builder.then = (resolve: (value: unknown) => unknown) =>
          resolve({ data: null, error: failOn === table ? { message: "boom" } : null });
        return builder;
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["delete", "eq", "insert", "upsert"]) {
        builder[method] = make(method);
      }
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: null, error: failOn === table ? { message: "boom" } : null });
      return builder;
    },
  };
  return { service: service as never, calls, setFailOn: (table: string | null) => { failOn = table; } };
}

describe("executeRestore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delete-then-inserts user tables with user_id stamped, restoring parents first", async () => {
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(service, "user-123", plan, ARCHIVE);
    expect(result.failedTable).toBeNull();

    const insertIdx = (table: string, op = "insert") =>
      calls.findIndex((call) => call.table === table && call.op === op);
    // accounts (parent) written before transactions (child).
    expect(insertIdx("accounts")).toBeLessThan(insertIdx("transactions", "upsert"));

    const accountInsert = calls.find(
      (call) => call.table === "accounts" && call.op === "insert",
    )!;
    expect((accountInsert.args[0] as Array<Record<string, unknown>>)[0]!.user_id).toBe("user-123");

    const deletes = calls.filter((call) => call.op === "delete");
    for (const del of deletes) {
      expect(del.args).toBeDefined();
    }
    expect(deletes.length).toBeGreaterThan(0);
  });

  it("skips shared/owner-scope tables instead of deleting other people's rows", async () => {
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(service, "user-123", plan, ARCHIVE);
    expect(result.skipped).toEqual([
      { name: "shared_expenses", reason: "involves other users' rows; not restorable in-app" },
    ]);
    expect(calls.some((call) => call.table === "shared_expenses")).toBe(false);
  });

  it("upserts transactions on plaid_transaction_id without a delete", async () => {
    const { service, calls } = serviceStub();
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(service, "user-123", plan, ARCHIVE);
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
    const result = await executeRestore(service, "user-123", plan, archive);
    expect(result.regeneratedIds).toBe(1);
  });

  it("reports the failed table instead of throwing", async () => {
    const stubControl = serviceStub();
    stubControl.setFailOn("transactions");
    const plan = buildRestorePlan(ARCHIVE);
    const result = await executeRestore(stubControl.service, "user-123", plan, ARCHIVE);
    expect(result.failedTable).toBe("transactions");
  });
});
