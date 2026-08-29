import { describe, expect, it, vi } from "vitest";
import {
  buildLedgerDayGroups,
  collectLedgerChunks,
  ledgerZebraBands,
  ledgerDatabaseOrder,
  needsProjectedLedgerPage,
  selectProjectedLedgerPage,
  shouldShowLedgerDayGroups,
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

describe("shouldShowLedgerDayGroups", () => {
  it("shows date subtotals only while date is the primary sort", () => {
    expect(shouldShowLedgerDayGroups("date")).toBe(true);
    expect(shouldShowLedgerDayGroups("amount")).toBe(false);
    expect(shouldShowLedgerDayGroups("merchant")).toBe(false);
    expect(shouldShowLedgerDayGroups("category")).toBe(false);
    expect(shouldShowLedgerDayGroups("account")).toBe(false);
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

describe("buildLedgerDayGroups", () => {
  const row = (id: string, date: string, amount: number) => ({ id, date, amount });

  it("nets every row sharing a date", () => {
    const groups = buildLedgerDayGroups([
      row("a", "2026-08-03", 10),
      row("b", "2026-08-03", 20),
      row("c", "2026-08-04", 5),
    ]);

    expect(groups.get("2026-08-03")).toMatchObject({ net: 30, visibleCount: 2 });
    expect(groups.get("2026-08-04")).toMatchObject({ net: 5, visibleCount: 1 });
  });

  it("withholds the net on a day holding a single transaction", () => {
    const groups = buildLedgerDayGroups([row("a", "2026-08-03", 10)]);

    // Restating the one amount directly below it is noise, not a total.
    expect(groups.get("2026-08-03")!.showNet).toBe(false);
  });

  it("shows the net once a day holds more than one transaction", () => {
    const groups = buildLedgerDayGroups([
      row("a", "2026-08-03", 10),
      row("b", "2026-08-03", 20),
    ]);

    expect(groups.get("2026-08-03")!.showNet).toBe(true);
  });

  it("excludes duplicate-marked rows from the net", () => {
    const groups = buildLedgerDayGroups(
      [row("a", "2026-08-03", 10), row("b", "2026-08-03", 20)],
      { excludedIds: new Set(["b"]) },
    );

    expect(groups.get("2026-08-03")!.net).toBe(10);
  });

  it("marks a day split across a page boundary incomplete and withholds its net", () => {
    const all = [
      row("a", "2026-08-03", 10),
      row("b", "2026-08-03", 20),
      row("c", "2026-08-03", 30),
    ];
    // Only the first two rows landed on this page.
    const groups = buildLedgerDayGroups(all.slice(0, 2), { allRows: all });

    const group = groups.get("2026-08-03")!;
    expect(group.complete).toBe(false);
    // A partial page sum presented as a daily total would be wrong.
    expect(group.showNet).toBe(false);
  });

  it("treats a day fully contained in the page as complete", () => {
    const all = [row("a", "2026-08-03", 10), row("b", "2026-08-04", 20)];
    const groups = buildLedgerDayGroups(all.slice(0, 1), { allRows: all });

    expect(groups.get("2026-08-03")!.complete).toBe(true);
  });

  it("assumes completeness when no full row set is supplied", () => {
    const groups = buildLedgerDayGroups([
      row("a", "2026-08-03", 10),
      row("b", "2026-08-03", 20),
    ]);

    expect(groups.get("2026-08-03")!.complete).toBe(true);
  });

  it("withholds a net for an explicitly incomplete direct-query boundary", () => {
    const groups = buildLedgerDayGroups(
      [row("a", "2026-08-03", 10), row("b", "2026-08-03", 20)],
      { incompleteDates: new Set(["2026-08-03"]) },
    );

    expect(groups.get("2026-08-03")).toMatchObject({
      complete: false,
      showNet: false,
    });
  });
});

describe("ledgerZebraBands", () => {
  const rows = [
    { date: "2026-08-15" },
    { date: "2026-08-15" },
    { date: "2026-08-15" },
    { date: "2026-08-14" },
    { date: "2026-08-14" },
  ];

  it("restarts banding at each day when grouping is active", () => {
    // Striping that ran straight through the headers did not line up with the
    // groups it was meant to organise.
    expect(ledgerZebraBands(rows, true)).toEqual([0, 1, 2, 0, 1]);
  });

  it("bands continuously when grouping is off", () => {
    expect(ledgerZebraBands(rows, false)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns an empty array for no rows", () => {
    expect(ledgerZebraBands([], true)).toEqual([]);
  });
});
