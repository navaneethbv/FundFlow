import type { NetWorthAccount } from "@/lib/planning";

/**
 * Shared balance-sheet composition for net worth.
 *
 * Three surfaces answer "what is my net worth" - the stored monthly snapshot
 * (`lib/net-worth.ts`), the Dashboard's live open-month observation
 * (`lib/dashboard.ts`), and the forecast's starting state
 * (`lib/forecasting-data.ts`). They disagreed once, and the Dashboard reported
 * a number that omitted manual accounts and ignored the user's exclusions, so
 * the rules for which balances count live here in one place.
 */

/** A connected (Plaid) account row, as selected from `accounts`. */
export interface PlaidBalanceRow {
  id: string;
  name?: string | null;
  type: string | null;
  subtype?: string | null;
  current_balance: number | string | null;
}

/** A user-entered account row, as selected from `manual_accounts`. */
export interface ManualBalanceRow {
  id: string;
  name?: string | null;
  account_type: string | null;
  balance: number | string | null;
  include_in_net_worth?: boolean | null;
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The per-account net-worth exclusions the Accounts page writes into
 * `profiles.dashboard_prefs`. Every net-worth surface has to honour it, or it
 * reports a balance sheet the user already told the app to stop counting.
 */
export function readExcludedNetWorthIds(dashboardPrefs: unknown): Set<string> {
  const accountsPage = (dashboardPrefs as Record<string, unknown> | null | undefined)
    ?.accountsPage as { excludedNetWorthIds?: unknown } | undefined;
  return Array.isArray(accountsPage?.excludedNetWorthIds)
    ? new Set(
        accountsPage.excludedNetWorthIds.filter(
          (id): id is string => typeof id === "string",
        ),
      )
    : new Set<string>();
}

/**
 * Connected and manual accounts merged into the one shape
 * `computeNetWorthSnapshot` reads, with both exclusion mechanisms applied:
 * the Accounts page's explicit id list and a manual account's own
 * `include_in_net_worth` column. Only an explicit `false` on that column
 * excludes - an absent column would otherwise silently zero the balance sheet.
 */
export function composeNetWorthAccounts(input: {
  plaidAccounts: readonly PlaidBalanceRow[];
  manualAccounts: readonly ManualBalanceRow[];
  excludedNetWorthIds: ReadonlySet<string>;
}): NetWorthAccount[] {
  const { plaidAccounts, manualAccounts, excludedNetWorthIds } = input;
  return [
    ...plaidAccounts.map((account) => ({
      name: account.name?.trim() || "Account",
      type: account.type,
      subtype: account.subtype ?? null,
      balance: numeric(account.current_balance),
      includeInNetWorth: !excludedNetWorthIds.has(account.id),
    })),
    ...manualAccounts.map((account) => ({
      name: account.name?.trim() || "Account",
      type: account.account_type,
      subtype: null,
      balance: numeric(account.balance),
      includeInNetWorth:
        account.include_in_net_worth !== false && !excludedNetWorthIds.has(account.id),
    })),
  ];
}
