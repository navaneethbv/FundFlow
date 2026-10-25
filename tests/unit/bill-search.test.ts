import { describe, expect, it, vi } from "vitest";
import {
  BILL_SEARCH_LIMIT,
  formatBillDate,
  formatBillTime,
  parseBillQuery,
  searchBills,
  toBillMatch,
} from "@/lib/bill-search";

type Call = { table: string; method: string; args: unknown[] };

/** A chainable PostgREST stand-in that records every call per table. */
function fakeSupabase(results: Record<string, { data: unknown; error: unknown }>) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "or", "in", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown) => resolve(results[table] ?? { data: [], error: null });
    return builder;
  });
  return { client: { from } as never, calls, from };
}

const baseRow = {
  id: "t1",
  date: "2026-04-17",
  authorized_date: "2026-04-16",
  amount: "157.81",
  iso_currency_code: "USD",
  name: "PROLIANCE SURGEONS INC PS",
  merchant_name: "Proliance Surgeons Inc Ps",
  pfc_primary: "MEDICAL",
  payment_channel: "in store",
  pending: false,
  account_id: "a1",
};

const card = { id: "a1", name: "Chase Freedom Unlimited", mask: "9181", type: "credit", subtype: "credit card" };

describe("parseBillQuery", () => {
  it.each([
    ["157.81", "157.81"],
    ["$157.81", "157.81"],
    ["$ 1,204.5", "1204.50"],
    [" 42 ", "42.00"],
  ])("reads %s as an amount", (raw, amount) => {
    expect(parseBillQuery(raw)).toEqual({ kind: "amount", amount });
  });

  it("reads a name as text and strips PostgREST syntax", () => {
    expect(parseBillQuery("Comcast")).toEqual({ kind: "text", term: "Comcast" });
    expect(parseBillQuery("a,b.(c)%")).toEqual({ kind: "text", term: "a b c" });
  });

  it.each([undefined, null, "", "   ", "x", "%,"])("treats %s as empty", (raw) => {
    expect(parseBillQuery(raw)).toEqual({ kind: "empty" });
  });

  it("does not read malformed money as an amount", () => {
    expect(parseBillQuery("12.345")).toEqual({ kind: "text", term: "12 345" });
  });

  it("caps the query length", () => {
    const parsed = parseBillQuery("a".repeat(200));
    expect(parsed.kind === "text" && parsed.term.length).toBe(80);
  });
});

describe("toBillMatch", () => {
  it("returns the full bill details for a card charge", () => {
    expect(toBillMatch(baseRow, new Map([["a1", card]]))).toEqual({
      id: "t1",
      date: "2026-04-16",
      time: null,
      provider: "Proliance Surgeons Inc Ps",
      description: "PROLIANCE SURGEONS INC PS",
      total: 157.81,
      direction: "charge",
      currency: "USD",
      category: "Medical",
      pending: false,
      paymentChannel: "in store",
      paidWith: "Chase Freedom Unlimited ••9181",
      paidWithType: "Credit card",
    });
  });

  it("marks negative amounts as refunds and prefers the authorized time", () => {
    const match = toBillMatch(
      { ...baseRow, amount: -20, datetime: "2026-04-17T10:00:00Z", authorized_datetime: "2026-04-16T22:05:00Z" },
      new Map(),
    );
    expect(match).toMatchObject({ total: 20, direction: "refund", time: "2026-04-16T22:05:00Z", paidWith: "Unknown account" });
  });

  it("falls back across names, dates, currency and account types", () => {
    const row = {
      ...baseRow, merchant_name: null, authorized_date: null, iso_currency_code: null,
      pfc_primary: null, pending: null, datetime: "2026-04-17T10:00:00Z",
    };
    expect(toBillMatch(row, new Map([["a1", { ...card, type: "depository", subtype: "checking" }]]))).toMatchObject({
      provider: "PROLIANCE SURGEONS INC PS",
      description: null,
      date: "2026-04-17",
      currency: "USD",
      category: null,
      pending: false,
      time: "2026-04-17T10:00:00Z",
      paidWithType: "Debit (checking)",
    });
    expect(toBillMatch({ ...row, name: null }, new Map()).provider).toBe("Unknown provider");
    expect(toBillMatch(row, new Map([["a1", { ...card, type: "loan", subtype: "auto" }]])).paidWithType).toBe("Auto");
    expect(toBillMatch(row, new Map([["a1", { ...card, type: "loan", subtype: null }]])).paidWithType).toBe("Loan");
    expect(toBillMatch(row, new Map([["a1", { ...card, type: null, subtype: null }]])).paidWithType).toBeNull();
  });

  it("names a manual account when there is no linked one", () => {
    const row = { ...baseRow, account_id: null, manual_account_id: "m1" };
    expect(toBillMatch(row, new Map(), new Map([["m1", { id: "m1", name: "Cash", account_type: "cash" }]]))).toMatchObject({
      paidWith: "Cash",
      paidWithType: "Manual (cash)",
    });
    expect(toBillMatch(row, new Map(), new Map([["m1", { id: "m1", name: null, account_type: null }]]))).toMatchObject({
      paidWith: "Manual account",
      paidWithType: "Manual",
    });
  });
});

describe("searchBills", () => {
  const options = { includeTime: false, includeManualAccounts: false };

  it("does not query for an empty search", async () => {
    const { client, from } = fakeSupabase({});
    await expect(searchBills(client, "u1", { kind: "empty" }, options)).resolves.toEqual({ matches: [], truncated: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("matches an amount in either sign, scoped to the user, and joins the card", async () => {
    const { client, calls } = fakeSupabase({
      transactions: { data: [baseRow], error: null },
      accounts: { data: [card], error: null },
    });
    const result = await searchBills(client, "u1", { kind: "amount", amount: "157.81" }, options);
    expect(result.truncated).toBe(false);
    expect(result.matches[0]).toMatchObject({ paidWith: "Chase Freedom Unlimited ••9181", total: 157.81 });
    expect(calls).toContainEqual({ table: "transactions", method: "eq", args: ["user_id", "u1"] });
    expect(calls).toContainEqual({ table: "transactions", method: "or", args: ["amount.eq.157.81,amount.eq.-157.81"] });
    expect(calls).toContainEqual({ table: "accounts", method: "eq", args: ["user_id", "u1"] });
    expect(calls).toContainEqual({ table: "accounts", method: "in", args: ["id", ["a1"]] });
    const select = calls.find((call) => call.table === "transactions" && call.method === "select");
    expect(select?.args[0]).not.toContain("datetime");
    expect(select?.args[0]).not.toContain("manual_account_id");
  });

  it("matches names and reads the optional columns when enabled", async () => {
    const rows = Array.from({ length: BILL_SEARCH_LIMIT + 1 }, (_, index) => ({
      ...baseRow, id: `t${index}`, account_id: null, manual_account_id: "m1",
    }));
    const { client, calls } = fakeSupabase({
      transactions: { data: rows, error: null },
      manual_accounts: { data: [{ id: "m1", name: "Cash", account_type: "cash" }], error: null },
    });
    const result = await searchBills(client, "u1", { kind: "text", term: "Comcast" }, { includeTime: true, includeManualAccounts: true });
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(BILL_SEARCH_LIMIT);
    expect(result.matches[0]?.paidWith).toBe("Cash");
    expect(calls).toContainEqual({ table: "transactions", method: "or", args: ["merchant_name.ilike.%Comcast%,name.ilike.%Comcast%"] });
    expect(calls).toContainEqual({ table: "manual_accounts", method: "eq", args: ["user_id", "u1"] });
    expect(calls).not.toContainEqual(expect.objectContaining({ table: "accounts" }));
    const select = calls.find((call) => call.table === "transactions" && call.method === "select");
    expect(select?.args[0]).toContain("datetime,authorized_datetime");
    expect(select?.args[0]).toContain("manual_account_id");
  });

  it("surfaces query errors", async () => {
    const failure = { code: "42501" };
    await expect(searchBills(fakeSupabase({ transactions: { data: null, error: failure } }).client, "u1", { kind: "text", term: "ab" }, options))
      .rejects.toBe(failure);
    await expect(searchBills(fakeSupabase({
      transactions: { data: [baseRow], error: null },
      accounts: { data: null, error: failure },
    }).client, "u1", { kind: "text", term: "ab" }, options)).rejects.toBe(failure);
    await expect(searchBills(fakeSupabase({
      transactions: { data: [{ ...baseRow, account_id: null, manual_account_id: "m1" }], error: null },
      manual_accounts: { data: null, error: failure },
    }).client, "u1", { kind: "text", term: "ab" }, { ...options, includeManualAccounts: true })).rejects.toBe(failure);
  });

  it("treats a null data payload as no matches", async () => {
    const { client } = fakeSupabase({ transactions: { data: null, error: null } });
    await expect(searchBills(client, "u1", { kind: "amount", amount: "1.00" }, options)).resolves.toEqual({ matches: [], truncated: false });
  });
});

describe("formatting", () => {
  it("formats a date key without shifting it", () => {
    expect(formatBillDate("2026-04-16")).toBe("Thu, Apr 16, 2026");
  });

  it("formats a time in the viewer's timezone", () => {
    expect(formatBillTime("2026-04-16T22:05:00Z", "America/Los_Angeles")).toBe("3:05 PM PDT");
  });

  it("falls back to UTC for an unknown timezone and null for missing times", () => {
    expect(formatBillTime("2026-04-16T22:05:00Z", "Not/AZone")).toBe("10:05 PM UTC");
    expect(formatBillTime(null, "UTC")).toBeNull();
    expect(formatBillTime("not a date", "UTC")).toBeNull();
  });
});
