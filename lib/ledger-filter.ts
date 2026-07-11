import { applyMerchantRules, type MerchantRule } from "@/lib/planning";

/**
 * The ledger's `category`/`merchant` filters run in SQL against the *stored*
 * Plaid values, but merchant rules recategorize/rename rows in-app. So a drill
 * into a rule-renamed category or merchant would miss (or mis-list) exactly the
 * rows the dashboard reassigned. When the user has rules that remap, the page
 * fetches the rule-independent scope and filters here, on the rules-applied
 * values, so the ledger and the dashboard drill agree.
 *
 * `sub` (pfc_detailed), `flow`, `accountType`, `month`, `accountId` and free
 * search stay in SQL — rules never touch them.
 */

/** True when any enabled rule can change a row's category or merchant name. */
export function hasRemapRules(rules: MerchantRule[]): boolean {
  return rules.some(
    (rule) => rule.enabled && Boolean(rule.category?.trim() || rule.displayName?.trim()),
  );
}

interface RuleFilterRow {
  id: string;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  account_id: string;
}

/**
 * Filter rows by the rules-applied category and/or merchant. `category` matches
 * the applied primary category (null → "UNCATEGORIZED", the same sentinel the
 * dashboard uses); `merchant` is an exact, case-insensitive match on the
 * applied merchant name. Row order is preserved.
 */
export function filterRowsWithRules<T extends RuleFilterRow>(
  rows: T[],
  rules: MerchantRule[],
  accountNamesById: Map<string, string>,
  filter: { category?: string; merchant?: string },
): T[] {
  if (!filter.category && !filter.merchant) return rows;

  const applied = applyMerchantRules(
    rows.map((row) => ({
      id: row.id,
      merchant: row.merchant_name ?? row.name ?? "",
      category: row.pfc_primary,
      accountName: accountNamesById.get(row.account_id) ?? "",
    })),
    rules,
  );

  const wantMerchant = filter.merchant?.trim().toLowerCase();
  return rows.filter((_, index) => {
    const row = applied[index]!;
    if (filter.category && (row.category ?? "UNCATEGORIZED") !== filter.category) return false;
    if (wantMerchant && row.merchant.trim().toLowerCase() !== wantMerchant) return false;
    return true;
  });
}
