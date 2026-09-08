import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { clientStub, type QueryResult } from "../fixtures/supabase-query";

let enabled = true;
let records: Array<Record<string, unknown>> = [];
let rules: Array<Record<string, unknown>> = [];
let failure: { code: string } | null = null;
const calls: string[] = [];
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: (name: string) => name !== "transactionReview" || enabled }));
const owner = "11111111-1111-4111-8111-111111111111";
function sourceQuery() {
  let filtered = records.slice();
  let from = 0;
  let to = Infinity;
  const orders: Array<{ key: string; ascending: boolean }> = [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filtered = filtered.filter((row) => row[key] === value); return query; },
    gte: (key: string, value: string) => { filtered = filtered.filter((row) => String(row[key]) >= value); return query; },
    lte: (key: string, value: string) => { filtered = filtered.filter((row) => String(row[key]) <= value); return query; },
    order: (key: string, options: { ascending: boolean }) => { orders.push({ key, ...options }); return query; },
    range: (start: number, end: number) => { from = start; to = end; return query; },
    then: (resolve: (result: QueryResult) => unknown) => {
      filtered.sort((a, b) => {
        for (const { key, ascending } of orders) {
          const av = a[key]; const bv = b[key];
          const delta = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
          if (delta) return ascending ? delta : -delta;
        }
        return 0;
      });
      return resolve({ data: filtered.slice(from, to + 1), count: filtered.length, error: failure });
    },
  };
  return query;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const other = clientStub({ saved_views: { data: [] }, accounts: { data: [] }, manual_accounts: { data: [] }, merchant_rules: { data: rules }, goals: { data: [] }, transaction_annotations: { data: [] }, transaction_splits: { data: [] }, linked_duplicates: { data: [] } });
  return { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, from: (table: string) => {
    calls.push(table);
    return table === "transactions" || table === "transaction_review_ledger" ? sourceQuery() : other.from(table);
  } };
} }));
import Page from "@/app/transactions/page";
import MobileLedgerList from "@/components/transactions/MobileLedgerList";
import { TransactionReviewScope } from "@/components/transactions/TransactionReviewProvider";

function elements(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function rowsIn(tree: unknown) {
  return elements(tree).find((node) => node.type === MobileLedgerList)?.props.rows as Array<{ id: string }>;
}
function fixture(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, user_id: owner,
    date: "2026-09-01", amount: i + 1, name: `Shop ${String(i).padStart(4, "0")}`, merchant_name: `Shop ${String(i).padStart(4, "0")}`,
    pfc_primary: "GENERAL_MERCHANDISE", pending: false, account_id: i % 2 ? "account-a" : "account-b",
    review_status: i % 3 ? "needs_review" : "reviewed", review_version: "1", review_eligible: true, review_state_missing: false,
  }));
}
beforeEach(() => { records = []; rules = []; failure = null; enabled = true; calls.length = 0; });
describe("transaction review page contract", () => {
  it("shows caught-up for an empty queue, and filtered-empty only when work remains", async () => {
    let tree = await Page({ searchParams: Promise.resolve({ review: "needs_review" }) });
    expect(elements(tree).some((node) => node.props.title === "You're all caught up")).toBe(true);
    records = fixture(2);
    tree = await Page({ searchParams: Promise.resolve({ review: "needs_review", month: "2026-08" }) });
    expect(elements(tree).some((node) => node.props.title === "No transactions need review with these filters")).toBe(true);
  });
  it("recovers the last valid page with the remaining URL controls", async () => {
    records = fixture(50).map((row) => ({ ...row, review_status: "needs_review" }));
    await expect(Page({ searchParams: Promise.resolve({ review: "needs_review", page: "2", month: "2026-09", sort: "amount", direction: "asc" }) })).rejects.toMatchObject({ digest: expect.stringContaining("/transactions?month=2026-09&review=needs_review&sort=amount&direction=asc") });
  });
  it("fails closed for missing state anywhere in the owner scope", async () => {
    records = [{ ...fixture(1)[0], review_status: null, review_eligible: false, review_state_missing: true }];
    const tree = await Page({ searchParams: Promise.resolve({ review: "needs_review" }) });
    expect(elements(tree).some((node) => node.props.title === "Transactions unavailable")).toBe(true);
    expect(elements(tree).find((node) => node.type === TransactionReviewScope)?.props.authoritative).toBe(false);
    expect(elements(tree).some((node) => node.props.needsReviewGlobalCount === 0)).toBe(false);
  });
  it("does not query the new schema when review is disabled", async () => {
    enabled = false;
    await Page({ searchParams: Promise.resolve({ review: "needs_review" }) });
    expect(calls).not.toContain("transaction_review_ledger");
  });
  it("keeps the full 1805-row review scope through direct and projected pagination", async () => {
    records = fixture(1805);
    const selected = records.filter((row) => row.review_status === "needs_review");
    for (const page of [1, 20, 25]) {
      const direct = await Page({ searchParams: Promise.resolve({ review: "needs_review", page: String(page), sort: "date", direction: "asc" }) });
      rules = [{ match_type: "keyword", pattern: "Shop", display_name: "Renamed", category: "TRAVEL", enabled: true }];
      const projected = await Page({ searchParams: Promise.resolve({ review: "needs_review", page: String(page), sort: "merchant", direction: "asc", category: "TRAVEL" }) });
      expect(rowsIn(direct).map((row) => row.id)).toEqual(selected.slice((page - 1) * 50, page * 50).map((row) => row.id));
      expect(rowsIn(projected).map((row) => row.id)).toEqual(rowsIn(direct).map((row) => row.id));
      rules = [];
    }
  });
  it("bounds the 10000-row default loader to chunked queries, not per-row reads", async () => {
    records = fixture(10000);
    await Page({ searchParams: Promise.resolve({}) });
    // Page query plus 11 facet chunks (including the empty sentinel) and
    // the independent owner queue/integrity counts.
    expect(calls.filter((table) => table === "transaction_review_ledger")).toHaveLength(14);
    calls.length = 0;
    enabled = false;
    await Page({ searchParams: Promise.resolve({}) });
    expect(calls.filter((table) => table === "transactions")).toHaveLength(12);
  });

});
