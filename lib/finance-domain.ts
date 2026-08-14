import { applyMerchantRules, type MerchantRule } from "@/lib/planning";
import { buildCategoryOverrideMap, overrideCategory, type CategoryOverrideRow } from "@/lib/insights";
import { validateSplits, type TransactionSplit } from "@/lib/transaction-quality";

/**
 * The canonical financial projection — the single place transaction meaning is
 * decided. Pages must consume `CanonicalFinanceTransaction` rows rather than
 * re-applying merchant rules, category overrides, splits, refund netting, or
 * transfer exclusion themselves; that is exactly how two screens end up
 * disagreeing about the same month's totals.
 *
 * Sign convention follows Plaid throughout: positive = money out.
 */

/**
 * Categories that are cash movement, not spending or earning.
 *
 * `LOAN_DISBURSEMENTS` belongs here for the same reason `LOAN_PAYMENTS` does,
 * and the two must stay together: excluding the repayment while counting the
 * draw as income reports borrowed money as earnings and then hides the
 * repayment that cancels it, which inflates income, net, and savings rate
 * everywhere at once.
 */
export const TRANSFER_GROUPS = new Set([
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
]);

export const UNCATEGORIZED = "UNCATEGORIZED";

export type FinanceSource = "plaid" | "import" | "manual";

/**
 * `transfer` means "money moved but it is neither spending nor income": Plaid
 * transfer/loan-payment categories, and both halves of a linked refund pair.
 * Cash-flow views that want literal account movement read `signedAmount` and
 * ignore `flow`.
 */
export type FinanceFlow = "income" | "expense" | "transfer";

export interface RawFinanceTransaction {
  id: string;
  providerTransactionId: string;
  userId: string;
  accountId: string | null;
  manualAccountId: string | null;
  date: string;
  amount: number;
  merchant: string | null;
  name: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pending: boolean;
  source: FinanceSource;
}

export interface CanonicalFinanceTransaction {
  /** Unique per projected row. A split parent yields one id per part. */
  id: string;
  /** The `transactions.id` this row came from; split parts share it. */
  sourceTransactionId: string;
  date: string;
  signedAmount: number;
  flow: FinanceFlow;
  merchant: string;
  groupKey: string;
  categoryKey: string;
  accountId: string | null;
  manualAccountId: string | null;
  pending: boolean;
  source: FinanceSource;
}

export interface LinkedRefundPair {
  chargeTransactionId: string;
  refundTransactionId: string;
}

export interface ProjectFinanceInput {
  rows: RawFinanceTransaction[];
  merchantRules: MerchantRule[];
  categoryOverrides: CategoryOverrideRow[];
  splits: TransactionSplit[];
  linkedRefunds: LinkedRefundPair[];
  excludedTransactionIds?: Set<string>;
  /** Account id → name, only needed for merchant rules that match on account. */
  accountNames?: Map<string, string>;
}

function displayMerchant(row: RawFinanceTransaction): string {
  return row.merchant ?? row.name ?? "";
}

function flowFor(signedAmount: number, groupKey: string): FinanceFlow {
  if (TRANSFER_GROUPS.has(groupKey)) return "transfer";
  return signedAmount > 0 ? "expense" : "income";
}

/**
 * Overrides that touch a transfer category in either direction are dropped, so
 * a rename can never hide a transfer from — or smuggle one into — spend totals.
 */
function usableOverrides(rows: CategoryOverrideRow[]): CategoryOverrideRow[] {
  return rows.filter(
    (row) =>
      !TRANSFER_GROUPS.has(row.sourceCategory.trim().toUpperCase()) &&
      !TRANSFER_GROUPS.has(row.displayCategory.trim().toUpperCase()),
  );
}

export function projectFinanceTransactions(
  input: ProjectFinanceInput,
): CanonicalFinanceTransaction[] {
  const { rows, merchantRules, categoryOverrides, splits, linkedRefunds } = input;
  const rowsToProject = input.excludedTransactionIds
    ? rows.filter((row) => !input.excludedTransactionIds!.has(row.id))
    : rows;
  const accountNames = input.accountNames ?? new Map<string, string>();

  // 1. Merchant rules (rename + recategorize) over the raw descriptor.
  const cleaned = applyMerchantRules(
    rowsToProject.map((row) => ({
      id: row.id,
      merchant: displayMerchant(row),
      category: row.pfcPrimary,
      amount: row.amount,
      accountName: (row.accountId && accountNames.get(row.accountId)) || "",
    })),
    merchantRules,
  );

  // 2. Category overrides, applied after merchant rules so a rule's category
  //    can itself be remapped by a user rename.
  const overrides = buildCategoryOverrideMap(usableOverrides(categoryOverrides));

  // 3. Refund pairs: both halves stop counting as spending or income.
  const nettedIds = new Set<string>();
  for (const pair of linkedRefunds) {
    nettedIds.add(pair.chargeTransactionId);
    nettedIds.add(pair.refundTransactionId);
  }

  const splitsByTransaction = new Map<string, TransactionSplit[]>();
  for (const split of splits) {
    const existing = splitsByTransaction.get(split.transactionId) ?? [];
    existing.push(split);
    splitsByTransaction.set(split.transactionId, existing);
  }

  const projected: CanonicalFinanceTransaction[] = [];

  rowsToProject.forEach((row, index) => {
    const clean = cleaned[index]!;
    const groupKey = overrideCategory(overrides, clean.category) ?? UNCATEGORIZED;
    const flow = nettedIds.has(row.id) ? "transfer" : flowFor(row.amount, groupKey);

    const base = {
      sourceTransactionId: row.id,
      date: row.date,
      flow,
      merchant: clean.merchant,
      groupKey,
      accountId: row.accountId,
      manualAccountId: row.manualAccountId,
      pending: row.pending,
      source: row.source,
    } as const;

    // 4. Split expansion. Splits refine the category within the parent's group
    //    and always re-sum to the parent amount, so no total can drift.
    const rowSplits = splitsByTransaction.get(row.id);
    if (rowSplits && validateSplits({ id: row.id, amount: row.amount, category: row.pfcDetailed }, rowSplits).valid) {
      const sign = row.amount < 0 ? -1 : 1;
      rowSplits.forEach((split, splitIndex) => {
        projected.push({
          ...base,
          id: `${row.id}::${splitIndex}`,
          signedAmount: sign * Math.abs(split.amount),
          categoryKey: split.category,
        });
      });
      return;
    }

    projected.push({
      ...base,
      id: row.id,
      signedAmount: row.amount,
      categoryKey: row.pfcDetailed ?? groupKey,
    });
  });

  // 5. Stable order so paginated and in-memory consumers agree.
  return projected.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface FinanceTotals {
  income: number;
  expenses: number;
  net: number;
  count: number;
}

/**
 * Pending rows are included, matching the app's existing behavior. Callers that
 * offer a pending toggle filter through the query helpers rather than here, so
 * every total in the app has one definition.
 */
export function financeTotals(rows: CanonicalFinanceTransaction[]): FinanceTotals {
  let income = 0;
  let expenses = 0;
  for (const row of rows) {
    if (row.flow === "expense") expenses += row.signedAmount;
    else if (row.flow === "income") income += Math.abs(row.signedAmount);
  }
  return {
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    count: rows.length,
  };
}

/** The `transactions` row shape this adapter reads. */
export interface TransactionRow {
  id: string;
  user_id: string;
  /** Null for a manual row — see `manual_account_id` below (Phase 12). */
  account_id: string | null;
  manual_account_id?: string | null;
  /** Absent when a caller selects a narrower column set; provenance then
   *  falls back to "plaid" rather than throwing. */
  plaid_transaction_id?: string | null;
  date: string;
  amount: number;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  pending?: boolean | null;
}

function sourceFromProviderId(providerId: string): FinanceSource {
  if (providerId.startsWith("import-")) return "import";
  if (providerId.startsWith("manual-")) return "manual";
  return "plaid";
}

/**
 * Adapts today's schema to the canonical input. Provenance still comes from
 * the `plaid_transaction_id` prefix convention (`import-`, `manual-`) rather
 * than the `source` column added alongside `manual_account_id` — the prefix
 * is already relied on elsewhere (the sync overlap guard) and duplicating the
 * signal onto two columns risks them disagreeing; `source` is queryable in
 * SQL (e.g. the ledger's ColumnsMenu filter) without needing this parse.
 */
export function fromTransactionRow(row: TransactionRow): RawFinanceTransaction {
  const providerId = row.plaid_transaction_id ?? "";
  const source = sourceFromProviderId(providerId);

  return {
    id: row.id,
    providerTransactionId: providerId,
    userId: row.user_id,
    accountId: row.account_id,
    manualAccountId: row.manual_account_id ?? null,
    date: row.date,
    amount: row.amount,
    merchant: row.merchant_name,
    name: row.name,
    pfcPrimary: row.pfc_primary,
    pfcDetailed: row.pfc_detailed,
    pending: row.pending ?? false,
    source,
  };
}
