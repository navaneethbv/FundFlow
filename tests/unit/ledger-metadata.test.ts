import { afterEach, describe, expect, it, vi } from "vitest";
import { filterLedgerMetadata } from "@/lib/ledger-metadata";
import { parseLedgerQuery } from "@/lib/ledger-query";
import { projectLedgerRows } from "@/lib/ledger-projection";
import { IN_FILTER_CHUNK_SIZE } from "@/lib/postgrest-limits";

type Meta = { id?: string; transaction_id: string; [key: string]: unknown };
function reader(tables: Record<string, Meta[]>, fail?: string, incomplete?: string) {
  const calls: Array<{ table: string; owner: string; ids: string[]; order: string; from: number; to: number }> = [];
  return { calls, client: { from(table: string) {
    const call = { table, owner: "", ids: [] as string[], order: "", from: 0, to: 999 };
    const query = {
      select: () => query,
      eq: (_key: string, owner: string) => { call.owner = owner; return query; },
      in: (_key: string, ids: string[]) => { call.ids = ids; return query; },
      order: (key: string) => { call.order = key; return query; },
      range: (from: number, to: number) => { call.from = from; call.to = to; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        calls.push(call);
        const rows = (tables[table] ?? []).filter(row => call.ids.includes(row.transaction_id));
        return Promise.resolve({ data: rows.slice(call.from, call.to + 1), count: rows.length + (table === incomplete ? 1 : 0), error: table === fail ? { message: "timeout" } : null }).then(resolve);
      },
    };
    return query;
  } } as never };
}

function source(ids: string[]) {
  return projectLedgerRows(ids.map(id => ({ id, date: "2026-10-01", amount: 1, pending: false, iso_currency_code: "USD", merchant_name: id, name: id, pfc_primary: null, pfc_detailed: null, account_id: null })), [], new Map());
}
const tables = {
  transaction_annotations: [
    { transaction_id: "saved", note: "Lunch 50%_(PAID)", tags: ["work"], cleared_at: "2026-10-02" },
    { transaction_id: "rule", note: "lunch 500 paid", tags: ["personal"], rule_actions: { tags: ["work"] }, cleared_at: null },
    { transaction_id: "other", note: null, tags: ["Work", "working"], cleared_at: null },
  ],
  receipts: [{ id: "r", transaction_id: "saved" }],
  transaction_splits: [{ id: "s", transaction_id: "rule" }],
};
const rows = source(["saved", "rule", "other", "absent"]);

afterEach(() => vi.restoreAllMocks());

describe("effective ledger metadata", () => {
  it.each([
    [{ tag: "work" }, ["saved", "rule"]],
    [{ tagState: "tagged" }, ["saved", "rule", "other"]],
    [{ tagState: "untagged" }, ["absent"]],
    [{ note: "50%_(paid)" }, ["saved"]],
    [{ note: "lunch" }, ["saved", "rule"]],
    [{ cleared: "cleared" }, ["saved"]],
    [{ cleared: "uncleared" }, ["rule", "other", "absent"]],
    [{ receipt: "attached" }, ["saved"]],
    [{ receipt: "missing" }, ["rule", "other", "absent"]],
    [{ split: "split" }, ["rule"]],
    [{ split: "unsplit" }, ["saved", "other", "absent"]],
  ] as const)("matches %j literally with complete absence semantics", async (filter, expected) => {
    const db = reader(tables);
    const result = await filterLedgerMetadata(db.client, "owner", rows, parseLedgerQuery(filter));
    expect(result.map(row => row.id)).toEqual(expected);
    expect(db.calls.every(call => call.owner === "owner")).toBe(true);
  });

  it("uses projected effective rule tags even if the annotation has no user tags", async () => {
    const projected = [{ ...rows[0]!, ruleActions: { tags: ["effective"] } }];
    const db = reader({ transaction_annotations: [{ transaction_id: "saved", tags: null }] });
    expect(await filterLedgerMetadata(db.client, "owner", projected, parseLedgerQuery({ tag: "effective" }))).toEqual(projected);
  });

  it("does not query metadata without active filters or rows", async () => {
    const db = reader({});
    expect(await filterLedgerMetadata(db.client, "owner", rows, parseLedgerQuery({}))).toBe(rows);
    expect(await filterLedgerMetadata(db.client, "owner", [], parseLedgerQuery({ tag: "work" }))).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it("reads later ID batches and multiple metadata pages without dropping matches", async () => {
    const many = source(Array.from({ length: 401 }, (_, index) => String(index)));
    const db = reader({ receipts: Array.from({ length: 1002 }, (_, i) => ({ id: String(i), transaction_id: i === 1001 ? "400" : "199" })) });
    const result = await filterLedgerMetadata(db.client, "owner", many, parseLedgerQuery({ receipt: "attached" }));
    expect(result.map(row => row.id)).toEqual(["199", "400"]);
    expect(db.calls).toHaveLength(4);
    expect(db.calls.every(call => call.ids.length <= IN_FILTER_CHUNK_SIZE && call.owner === "owner" && call.order === "id")).toBe(true);
  });

  it("stops before subsequent ID batches after a failed metadata read", async () => {
    const many = source(Array.from({ length: 401 }, (_, index) => String(index)));
    const db = reader({}, "receipts");
    await expect(filterLedgerMetadata(db.client, "owner", many, parseLedgerQuery({ receipt: "missing" }))).rejects.toThrow("timeout");
    expect(db.calls).toHaveLength(1);
  });

  it("does not infer missing receipts from a truncated metadata page", async () => {
    const db = reader(tables, undefined, "receipts");
    await expect(filterLedgerMetadata(db.client, "owner", rows, parseLedgerQuery({ receipt: "missing" }))).rejects.toThrow("ledger_incomplete_page");
  });

  it("propagates a later metadata failure instead of returning earlier matches", async () => {
    const db = reader(tables, "receipts");
    await expect(filterLedgerMetadata(db.client, "owner", rows, parseLedgerQuery({ tag: "work", receipt: "missing" }))).rejects.toThrow("timeout");
  });
});

it.each([
  { data: null, count: 0, error: null },
  { data: [], count: null, error: null },
])("rejects a metadata response without complete rows and count: %j", async result => {
  const db = { from() { const query = { select: () => query, eq: () => query, in: () => query, order: () => query, range: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }; return query; } } as never;
  await expect(filterLedgerMetadata(db, "owner", rows, parseLedgerQuery({ receipt: "missing" }))).rejects.toThrow("ledger_metadata_incomplete");
});
