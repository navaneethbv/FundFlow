import { describe, expect, it } from "vitest";
import {
  CLEAR_LEDGER_FILTERS,
  hasActiveLedgerFilters,
  ledgerHref,
  ledgerQueryEntries,
  parseLedgerQuery,
  savedLedgerViewParams,
} from "@/lib/ledger-query";

describe("parseLedgerQuery", () => {
  it("normalizes amount bounds and preserves posting status through navigation and saved views", () => {
    const state = parseLedgerQuery({ minAmount: "0", maxAmount: "42.5", status: "pending", page: "2" });
    expect(state).toMatchObject({ minAmount: "0.00", maxAmount: "42.50", status: "pending" });
    expect(savedLedgerViewParams(state)).toEqual({ minAmount: "0.00", maxAmount: "42.50", status: "pending" });
    const next = new URL(ledgerHref(ledgerQueryEntries(state), { page: "3" }), "https://fundflow.test");
    expect(next.searchParams.get("minAmount")).toBe("0.00");
    expect(next.searchParams.get("maxAmount")).toBe("42.50");
    expect(next.searchParams.get("status")).toBe("pending");
    expect(next.searchParams.get("page")).toBe("3");
    expect(hasActiveLedgerFilters(state)).toBe(true);
    expect(parseLedgerQuery({ status: "posted" }).status).toBe("posted");
  });

  it.each(["-1", "NaN", "Infinity", "1e3", "0.001", "1,amount.gt.0", "10000000000", "."])("rejects unsafe or invalid amount %s", (value) => {
    expect(parseLedgerQuery({ minAmount: value, maxAmount: value, status: "invalid" })).toMatchObject({ minAmount: "", maxAmount: "", status: "" });
  });

  it("clears hidden date and new filters without removing presentation preferences", () => {
    const state = parseLedgerQuery({ day: "2026-09-01", year: "2026", minAmount: "1", maxAmount: "2", status: "posted", review: "reviewed", sort: "amount", page: "4" });
    expect(ledgerHref(ledgerQueryEntries(state), CLEAR_LEDGER_FILTERS)).toBe("/transactions?sort=amount");
  });
  it("defaults to Date newest first and page one", () => {
    const state = parseLedgerQuery({});

    expect(state.sort).toBe("date");
    expect(state.direction).toBe("desc");
    expect(state.page).toBe(1);
  });

  it("drops invalid enum, month, UUID, category, and page values", () => {
    const state = parseLedgerQuery({
      sort: "drop table",
      direction: "sideways",
      month: "2026-99",
      year: "202",
      accountId: "not-a-uuid",
      category: "food;delete",
      flow: "sideways",
      accountType: "loan",
      page: "-9",
    });

    expect(state).toMatchObject({
      sort: "date",
      direction: "desc",
      month: "",
      year: "",
      accountId: "",
      category: "",
      flow: "",
      accountType: "",
      page: 1,
    });

    const validState = parseLedgerQuery({
      year: "2026",
    });
    expect(validState.year).toBe("2026");
  });

  it("sanitizes PostgREST search syntax from search and merchant values", () => {
    const state = parseLedgerQuery({
      q: '  coffee,_shop.("  ',
      merchant: "ACME%STORE\\",
    });

    expect(state.q).toBe("coffee shop");
    expect(state.merchant).toBe("ACME STORE");
  });

  it("preserves repeated visible columns", () => {
    const state = parseLedgerQuery({
      colsSubmitted: "1",
      col: ["category", "account"],
    });

    expect([...state.columns]).toEqual(["category", "account"]);
    expect(ledgerQueryEntries(state).filter(([key]) => key === "col")).toEqual([
      ["col", "category"],
      ["col", "account"],
    ]);
  });

  it("preserves an explicit all-hidden column selection", () => {
    const state = parseLedgerQuery({ colsSubmitted: "1" });

    expect(state.columns.size).toBe(0);
    expect(ledgerQueryEntries(state)).toContainEqual(["colsSubmitted", "1"]);
  });
});

describe("ledgerHref", () => {
  it("overlays staged values, resets page, and preserves repeated columns", () => {
    const state = parseLedgerQuery({
      page: "3",
      q: "coffee",
      sort: "merchant",
      direction: "asc",
      colsSubmitted: "1",
      col: ["category", "source"],
    });

    const href = ledgerHref(ledgerQueryEntries(state), {
      month: "2026-08",
      accountId: null,
    });
    const url = new URL(href, "https://fundflow.test");

    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("q")).toBe("coffee");
    expect(url.searchParams.get("sort")).toBe("merchant");
    expect(url.searchParams.getAll("col")).toEqual(["category", "source"]);
  });

  it("clears filters without clearing sorting or columns", () => {
    const state = parseLedgerQuery({
      q: "coffee",
      month: "2026-08",
      sort: "amount",
      direction: "asc",
      colsSubmitted: "1",
      col: "account",
    });

    const href = ledgerHref(ledgerQueryEntries(state), {
      q: null,
      month: null,
      accountId: null,
      category: null,
      sub: null,
      merchant: null,
      flow: null,
      accountType: null,
    });
    const url = new URL(href, "https://fundflow.test");

    expect(url.searchParams.get("q")).toBeNull();
    expect(url.searchParams.get("month")).toBeNull();
    expect(url.searchParams.get("sort")).toBe("amount");
    expect(url.searchParams.get("direction")).toBe("asc");
    expect(url.searchParams.getAll("col")).toEqual(["account"]);
  });

  it("always returns the transactions path with encoded values", () => {
    const href = ledgerHref([], { q: "javascript:alert(1) & rent" });

    expect(href).toBe("/transactions?q=javascript%3Aalert%281%29+%26+rent");
  });
});

describe("savedLedgerViewParams", () => {
  it("stores filters and non-default sorting but not columns or page", () => {
    const state = parseLedgerQuery({
      q: "rent",
      sort: "account",
      direction: "desc",
      page: "4",
      colsSubmitted: "1",
      col: "source",
    });

    expect(savedLedgerViewParams(state)).toEqual({
      q: "rent",
      sort: "account",
      direction: "desc",
    });
    expect(hasActiveLedgerFilters(state)).toBe(true);
  });

  it("omits default sorting and reports an unfiltered state", () => {
    const state = parseLedgerQuery({ sort: "date", direction: "desc" });

    expect(savedLedgerViewParams(state)).toEqual({});
    expect(hasActiveLedgerFilters(state)).toBe(false);

    const ascDateState = parseLedgerQuery({ sort: "date", direction: "asc" });
    expect(savedLedgerViewParams(ascDateState)).toEqual({ direction: "asc" });
  });
});
