import {
  applyMerchantRules,
  type MerchantRule,
} from "@/lib/planning";
import { titleCase } from "@/lib/format";
import { subcategoryLabel } from "@/lib/drilldown";
import type {
  LedgerSortDirection,
  LedgerSortField,
} from "@/lib/ledger-query";

export interface LedgerDisplaySourceRow {
  id: string;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  account_id: string | null;
  manual_account_id?: string | null;
}

export interface LedgerProjectionSourceRow extends LedgerDisplaySourceRow {
  id: string;
  date: string;
  amount: number;
  iso_currency_code: string | null;
  pfc_detailed: string | null;
  pending: boolean;
  source?: "plaid" | "import" | "manual";
}

export interface LedgerDisplayRow {
  id: string;
  merchant: string;
  category: string | null;
  accountLabel: string;
}

export interface LedgerProjectedRow
  extends LedgerProjectionSourceRow,
    LedgerDisplayRow {
  displayedAmount: number;
}

export interface LedgerFilterOptions {
  accounts: Array<{ value: string; label: string }>;
  categories: Array<{ value: string; label: string }>;
  subcategoriesByCategory: Record<
    string,
    Array<{ value: string; label: string }>
  >;
  merchants: string[];
}

export function resolvedLedgerAccountId(
  row: Pick<LedgerDisplaySourceRow, "account_id" | "manual_account_id">,
): string {
  return row.account_id ?? row.manual_account_id ?? "";
}

export function projectLedgerDisplayRows<T extends LedgerDisplaySourceRow>(
  rows: T[],
  rules: MerchantRule[],
  ruleAccountNamesById: Map<string, string>,
  displayAccountLabelsById: Map<string, string> = ruleAccountNamesById,
): LedgerDisplayRow[] {
  const applied = applyMerchantRules(
    rows.map((row) => ({
      id: row.id,
      merchant: row.merchant_name ?? row.name ?? "",
      category: row.pfc_primary,
      accountName:
        ruleAccountNamesById.get(resolvedLedgerAccountId(row)) ?? "",
    })),
    rules,
  );

  return rows.map((row, index) => ({
    id: row.id,
    merchant: applied[index]!.merchant,
    category: applied[index]!.category,
    accountLabel:
      displayAccountLabelsById.get(resolvedLedgerAccountId(row)) ?? "",
  }));
}

export function projectLedgerRows<T extends LedgerProjectionSourceRow>(
  rows: T[],
  rules: MerchantRule[],
  ruleAccountNamesById: Map<string, string>,
  displayAccountLabelsById: Map<string, string> = ruleAccountNamesById,
): Array<T & LedgerProjectedRow> {
  const displayRows = projectLedgerDisplayRows(
    rows,
    rules,
    ruleAccountNamesById,
    displayAccountLabelsById,
  );
  return rows.map((row, index) => ({
    ...row,
    ...displayRows[index]!,
    displayedAmount: -row.amount,
  }));
}

const labelCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function compareOptionalLabels(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return labelCollator.compare(left, right);
}

function comparePrimary(
  a: LedgerProjectedRow,
  b: LedgerProjectedRow,
  field: LedgerSortField,
): { value: number; missingAware: boolean } {
  switch (field) {
    case "date":
      return { value: a.date.localeCompare(b.date), missingAware: false };
    case "amount":
      return {
        value: a.displayedAmount - b.displayedAmount,
        missingAware: false,
      };
    case "merchant":
      return {
        value: compareOptionalLabels(a.merchant, b.merchant),
        missingAware: !a.merchant.trim() || !b.merchant.trim(),
      };
    case "category":
      return {
        value: compareOptionalLabels(
          a.category ? titleCase(a.category) : "",
          b.category ? titleCase(b.category) : "",
        ),
        missingAware: !a.category?.trim() || !b.category?.trim(),
      };
    case "account":
      return {
        value: compareOptionalLabels(a.accountLabel, b.accountLabel),
        missingAware: !a.accountLabel.trim() || !b.accountLabel.trim(),
      };
  }
}

export function sortLedgerRows<T extends LedgerProjectedRow>(
  rows: T[],
  field: LedgerSortField,
  direction: LedgerSortDirection,
): T[] {
  return rows.toSorted((a, b) => {
    const primary = comparePrimary(a, b, field);
    if (primary.value !== 0) {
      if (primary.missingAware) return primary.value;
      return direction === "asc" ? primary.value : -primary.value;
    }
    return b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
  });
}

export function filterProjectedLedgerRows<
  T extends LedgerDisplayRow & { pfc_detailed?: string | null },
>(
  rows: T[],
  filters: { category?: string; sub?: string; merchant?: string },
): T[] {
  const wantedMerchant = filters.merchant?.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (
      filters.category &&
      (row.category ?? "UNCATEGORIZED") !== filters.category
    ) {
      return false;
    }
    if (filters.sub && row.pfc_detailed !== filters.sub) return false;
    if (
      wantedMerchant &&
      row.merchant.trim().toLocaleLowerCase() !== wantedMerchant
    ) {
      return false;
    }
    return true;
  });
}

export function buildLedgerFilterOptions(
  rows: LedgerProjectedRow[],
  accounts: Array<{ value: string; label: string }>,
): LedgerFilterOptions {
  const categories = new Map<string, string>();
  const subcategories = new Map<string, Map<string, string>>();
  const merchants = new Map<string, string>();

  for (const row of rows) {
    const category = row.category ?? "UNCATEGORIZED";
    categories.set(category, titleCase(category));
    if (row.pfc_detailed) {
      const categorySubs = subcategories.get(category) ?? new Map();
      categorySubs.set(
        row.pfc_detailed,
        subcategoryLabel(category, row.pfc_detailed),
      );
      subcategories.set(category, categorySubs);
    }
    const merchant = row.merchant.trim();
    if (merchant) merchants.set(merchant.toLocaleLowerCase(), merchant);
  }

  return {
    accounts: accounts.toSorted((a, b) =>
      labelCollator.compare(a.label, b.label),
    ),
    categories: [...categories.entries()]
      .map(([value, label]) => ({ value, label }))
      .toSorted((a, b) => labelCollator.compare(a.label, b.label)),
    subcategoriesByCategory: Object.fromEntries(
      [...subcategories.entries()].map(([category, values]) => [
        category,
        [...values.entries()]
          .map(([value, label]) => ({ value, label }))
          .toSorted((a, b) => labelCollator.compare(a.label, b.label)),
      ]),
    ),
    merchants: [...merchants.values()].toSorted((a, b) =>
      labelCollator.compare(a, b),
    ),
  };
}
