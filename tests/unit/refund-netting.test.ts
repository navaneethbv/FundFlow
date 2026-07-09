import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDashboardData } from "@/lib/dashboard";

type Row = Record<string, unknown>;

/**
 * Table-aware mock of the Supabase query builder. Every builder is thenable and
 * resolves canned rows keyed by table (and, for the two `transactions` reads,
 * by whether the select includes `amount` — the window read — vs the tiny
 * oldest-date probe served through maybeSingle).
 */
function makeSupabase(data: { accounts: Row[]; transactions: Row[]; linkedRefunds: Row[]; oldestDate: string }) {
  const from = (table: string) => {
    const state = { table, cols: "" };
    const chain: Record<string, unknown> = {};
    const resolveData = () => {
      switch (state.table) {
        case "accounts":
          return { data: data.accounts };
        case "transactions":
          return { data: state.cols.includes("amount") ? data.transactions : [] };
        case "linked_refunds":
          return { data: data.linkedRefunds };
        default:
          return { data: [] };
      }
    };
    Object.assign(chain, {
      select: (cols: string) => {
        state.cols = cols;
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      gte: () => chain,
      lt: () => chain,
      in: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve(
          state.table === "transactions" ? { data: { date: data.oldestDate } } : { data: null },
        ),
      then: (resolve: (value: { data: unknown }) => unknown) => resolve(resolveData()),
    });
    return chain;
  };
  return { from } as never;
}

const ACCOUNTS: Row[] = [
  {
    id: "acc1",
    name: "Checking",
    official_name: null,
    mask: "1234",
    type: "depository",
    subtype: "checking",
    current_balance: 100,
    available_balance: 100,
    credit_limit: null,
    iso_currency_code: "USD",
    plaid_item_id: "item1",
  },
];

// A charge (c1) and its equal-and-opposite refund (r1) at the same merchant,
// plus one unrelated cafe spend (o1). Only o1 should ever be counted as spend
// once c1/r1 are linked.
const TRANSACTIONS: Row[] = [
  { id: "c1", date: "2026-07-05", amount: 50, merchant_name: "Store", name: "Store", pfc_primary: "GENERAL_MERCHANDISE", account_id: "acc1" },
  { id: "r1", date: "2026-07-10", amount: -50, merchant_name: "Store", name: "Store", pfc_primary: "GENERAL_MERCHANDISE", account_id: "acc1" },
  { id: "o1", date: "2026-07-06", amount: 30, merchant_name: "Cafe", name: "Cafe", pfc_primary: "FOOD_AND_DRINK", account_id: "acc1" },
];

describe("refund netting in getDashboardData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops a linked charge/refund pair from category spend totals", async () => {
    const supabase = makeSupabase({
      accounts: ACCOUNTS,
      transactions: TRANSACTIONS,
      linkedRefunds: [{ charge_transaction_id: "c1", refund_transaction_id: "r1" }],
      oldestDate: "2026-01-01",
    });
    const result = await getDashboardData(supabase);
    const categories = new Map(result.categoryBreakdown.map((r) => [r.category, r.amount]));
    expect(categories.has("GENERAL_MERCHANDISE")).toBe(false);
    expect(categories.get("FOOD_AND_DRINK")).toBe(30);
  });

  it("counts the charge as spend when the pair is not linked", async () => {
    const supabase = makeSupabase({
      accounts: ACCOUNTS,
      transactions: TRANSACTIONS,
      linkedRefunds: [],
      oldestDate: "2026-01-01",
    });
    const result = await getDashboardData(supabase);
    const categories = new Map(result.categoryBreakdown.map((r) => [r.category, r.amount]));
    expect(categories.get("GENERAL_MERCHANDISE")).toBe(50);
    expect(categories.get("FOOD_AND_DRINK")).toBe(30);
  });
});
