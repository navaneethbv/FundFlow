import { describe, expect, it, vi } from "vitest";
import {
  collectLedgerChunks,
  ledgerDatabaseOrder,
  needsProjectedLedgerPage,
  selectProjectedLedgerPage,
} from "@/lib/ledger-data";
import { projectLedgerRows } from "@/lib/ledger-projection";

describe("collectLedgerChunks", () => {
  it("collects complete chunks until the first short chunk", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ rows: [1, 2], error: null })
      .mockResolvedValueOnce({ rows: [3], error: null });

    await expect(collectLedgerChunks(load, 2)).resolves.toEqual([1, 2, 3]);
    expect(load.mock.calls).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("stops after an empty first chunk", async () => {
    const load = vi.fn().mockResolvedValue({ rows: [], error: null });

    await expect(collectLedgerChunks(load, 1000)).resolves.toEqual([]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("throws instead of returning a partial result", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ rows: [1, 2], error: null })
      .mockResolvedValueOnce({
        rows: [],
        error: { code: "query_failed" },
      });

    await expect(collectLedgerChunks(load, 2)).rejects.toThrow(
      "query_failed",
    );
  });
});

describe("ledgerDatabaseOrder", () => {
  it("maps displayed amount direction to the inverse stored Plaid direction", () => {
    expect(ledgerDatabaseOrder("amount", "asc")).toEqual([
      { column: "amount", ascending: false },
      { column: "date", ascending: false },
      { column: "id", ascending: true },
    ]);
    expect(ledgerDatabaseOrder("amount", "desc")).toEqual([
      { column: "amount", ascending: true },
      { column: "date", ascending: false },
      { column: "id", ascending: true },
    ]);
  });

  it("maps date direction directly and uses transaction ID as the tie-breaker", () => {
    expect(ledgerDatabaseOrder("date", "asc")).toEqual([
      { column: "date", ascending: true },
      { column: "id", ascending: true },
    ]);
    expect(ledgerDatabaseOrder("date", "desc")).toEqual([
      { column: "date", ascending: false },
      { column: "id", ascending: true },
    ]);
  });
});

describe("needsProjectedLedgerPage", () => {
  it("uses projection for displayed labels and rule-aware display filters", () => {
    expect(needsProjectedLedgerPage("merchant", false)).toBe(true);
    expect(needsProjectedLedgerPage("category", false)).toBe(true);
    expect(needsProjectedLedgerPage("account", false)).toBe(true);
    expect(needsProjectedLedgerPage("date", true)).toBe(true);
    expect(needsProjectedLedgerPage("amount", false)).toBe(false);
  });
});

describe("selectProjectedLedgerPage", () => {
  it("filters and sorts the complete result before selecting the page", () => {
    const source = Array.from({ length: 55 }, (_, index) => ({
      id: String(index).padStart(2, "0"),
      date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      amount: index,
      iso_currency_code: "USD",
      merchant_name: index === 54 ? "Alpha" : `Merchant ${String(index).padStart(2, "0")}`,
      name: null,
      pfc_primary: index % 2 === 0 ? "FOOD_AND_DRINK" : "TRAVEL",
      pfc_detailed: null,
      pending: false,
      account_id: "account",
      manual_account_id: null,
    }));
    const projected = projectLedgerRows(
      source,
      [],
      new Map([["account", "Checking"]]),
    );

    const firstPage = selectProjectedLedgerPage(projected, {
      category: "",
      sub: "",
      merchant: "",
      sort: "merchant",
      direction: "asc",
      page: 1,
      pageSize: 50,
    });
    const secondPage = selectProjectedLedgerPage(projected, {
      category: "",
      sub: "",
      merchant: "",
      sort: "merchant",
      direction: "asc",
      page: 2,
      pageSize: 50,
    });

    expect(firstPage.total).toBe(55);
    expect(firstPage.rows[0]?.id).toBe("54");
    expect(firstPage.rows).toHaveLength(50);
    expect(secondPage.rows).toHaveLength(5);
    expect(new Set([...firstPage.rows, ...secondPage.rows].map((row) => row.id)).size).toBe(55);
  });
});
