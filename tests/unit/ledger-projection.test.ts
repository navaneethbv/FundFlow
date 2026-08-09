import { describe, expect, it } from "vitest";
import {
  buildLedgerFilterOptions,
  filterProjectedLedgerRows,
  projectLedgerRows,
  sortLedgerRows,
  type LedgerProjectionSourceRow,
} from "@/lib/ledger-projection";
import type { MerchantRule } from "@/lib/planning";

const accountNames = new Map([
  ["a-checking", "Everyday Checking ••1234"],
  ["z-card", "Travel Card ••9876"],
]);

const rules: MerchantRule[] = [
  {
    matchType: "keyword",
    pattern: "sq *bluebottle",
    displayName: "Blue Bottle",
    category: "FOOD_AND_DRINK",
    enabled: true,
  },
];

function row(
  input: Partial<LedgerProjectionSourceRow> &
    Pick<LedgerProjectionSourceRow, "id">,
): LedgerProjectionSourceRow {
  return {
    id: input.id,
    date: input.date ?? "2026-08-01",
    amount: input.amount ?? 10,
    merchant_name: input.merchant_name ?? null,
    name: input.name ?? null,
    pfc_primary: input.pfc_primary ?? null,
    pfc_detailed: input.pfc_detailed ?? null,
    account_id: input.account_id === undefined ? "a-checking" : input.account_id,
    manual_account_id: input.manual_account_id ?? null,
    iso_currency_code: input.iso_currency_code ?? "USD",
    pending: input.pending ?? false,
    source: input.source,
  };
}

describe("projectLedgerRows", () => {
  it("projects the rule-adjusted display values used by the ledger", () => {
    const projected = projectLedgerRows(
      [
        row({
          id: "1",
          amount: 42,
          merchant_name: "SQ *BlueBottle Coffee",
          pfc_primary: "GENERAL_MERCHANDISE",
        }),
        row({
          id: "2",
          amount: -500,
          account_id: null,
          manual_account_id: "manual",
          name: "Cash income",
        }),
      ],
      rules,
      new Map([...accountNames, ["manual", "Cash Wallet"]]),
    );

    expect(projected[0]).toMatchObject({
      merchant: "Blue Bottle",
      category: "FOOD_AND_DRINK",
      accountLabel: "Everyday Checking ••1234",
      displayedAmount: -42,
    });
    expect(projected[1]).toMatchObject({
      merchant: "Cash income",
      accountLabel: "Cash Wallet",
      displayedAmount: 500,
    });
  });
});

describe("sortLedgerRows", () => {
  const projected = projectLedgerRows(
    [
      row({
        id: "spend",
        date: "2026-08-03",
        amount: 100,
        merchant_name: "Zebra",
        pfc_primary: "TRAVEL",
        account_id: "z-card",
      }),
      row({
        id: "income",
        date: "2026-08-02",
        amount: -500,
        merchant_name: "Alpha",
        pfc_primary: "INCOME",
      }),
      row({
        id: "tie-b",
        date: "2026-08-01",
        amount: 25,
        merchant_name: "Same",
        pfc_primary: "FOOD_AND_DRINK",
      }),
      row({
        id: "tie-a",
        date: "2026-08-01",
        amount: 25,
        merchant_name: "Same",
        pfc_primary: "FOOD_AND_DRINK",
      }),
      row({
        id: "missing",
        date: "2026-08-04",
        amount: 1,
        account_id: null,
      }),
    ],
    [],
    accountNames,
  );

  it("sorts the signed displayed amount instead of the stored Plaid amount", () => {
    expect(
      sortLedgerRows(projected, "amount", "asc")
        .map((item) => item.id)
        .slice(0, 2),
    ).toEqual(["spend", "tie-a"]);
    expect(sortLedgerRows(projected, "amount", "desc")[0]?.id).toBe(
      "income",
    );
  });

  it("sorts dates in both directions", () => {
    expect(sortLedgerRows(projected, "date", "asc")[0]?.id).toBe("tie-a");
    expect(sortLedgerRows(projected, "date", "desc")[0]?.id).toBe(
      "missing",
    );
  });

  it("sorts merchant, category, and account by displayed labels", () => {
    expect(sortLedgerRows(projected, "merchant", "asc")[0]?.id).toBe(
      "income",
    );
    expect(sortLedgerRows(projected, "category", "desc")[0]?.id).toBe(
      "spend",
    );
    expect(sortLedgerRows(projected, "account", "desc")[0]?.id).toBe(
      "spend",
    );
  });

  it("keeps missing labels last in both directions", () => {
    expect(sortLedgerRows(projected, "merchant", "asc").at(-1)?.id).toBe(
      "missing",
    );
    expect(sortLedgerRows(projected, "merchant", "desc").at(-1)?.id).toBe(
      "missing",
    );
    expect(sortLedgerRows(projected, "category", "asc").at(-1)?.id).toBe(
      "missing",
    );
    expect(sortLedgerRows(projected, "account", "desc").at(-1)?.id).toBe(
      "missing",
    );
  });

  it("uses date descending and id ascending for equal primary values", () => {
    const ids = sortLedgerRows(projected, "merchant", "asc").map(
      (item) => item.id,
    );

    expect(ids.indexOf("tie-a")).toBeLessThan(ids.indexOf("tie-b"));
  });
});

describe("filterProjectedLedgerRows", () => {
  const projected = projectLedgerRows(
    [
      row({
        id: "coffee",
        merchant_name: "SQ *BlueBottle Coffee",
        pfc_primary: "GENERAL_MERCHANDISE",
        pfc_detailed: "FOOD_AND_DRINK_COFFEE",
      }),
      row({
        id: "groceries",
        merchant_name: "Safeway",
        pfc_primary: "FOOD_AND_DRINK",
        pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
      }),
      row({ id: "unknown", merchant_name: "Mystery", pfc_primary: null }),
    ],
    rules,
    accountNames,
  );

  it("matches committed category, subcategory, and merchant on projected values", () => {
    expect(
      filterProjectedLedgerRows(projected, {
        category: "FOOD_AND_DRINK",
        sub: "FOOD_AND_DRINK_COFFEE",
        merchant: "blue bottle",
      }).map((item) => item.id),
    ).toEqual(["coffee"]);
  });

  it("uses UNCATEGORIZED as the null-category sentinel", () => {
    expect(
      filterProjectedLedgerRows(projected, {
        category: "UNCATEGORIZED",
      }).map((item) => item.id),
    ).toEqual(["unknown"]);
  });
});

describe("buildLedgerFilterOptions", () => {
  it("derives cleaned merchants and category-scoped subcategories", () => {
    const projected = projectLedgerRows(
      [
        row({
          id: "coffee",
          merchant_name: "SQ *BlueBottle Coffee",
          pfc_primary: "GENERAL_MERCHANDISE",
          pfc_detailed: "FOOD_AND_DRINK_COFFEE",
        }),
        row({
          id: "groceries",
          merchant_name: "Safeway",
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
        }),
      ],
      rules,
      accountNames,
    );

    const options = buildLedgerFilterOptions(projected, [
      { value: "a-checking", label: "Everyday Checking ••1234" },
    ]);

    expect(options.merchants).toEqual(["Blue Bottle", "Safeway"]);
    expect(options.categories).toContainEqual({
      value: "FOOD_AND_DRINK",
      label: "Food And Drink",
    });
    expect(options.subcategoriesByCategory.FOOD_AND_DRINK).toEqual([
      { value: "FOOD_AND_DRINK_COFFEE", label: "Coffee" },
      { value: "FOOD_AND_DRINK_GROCERIES", label: "Groceries" },
    ]);
    expect(options.accounts).toEqual([
      { value: "a-checking", label: "Everyday Checking ••1234" },
    ]);
  });
});
