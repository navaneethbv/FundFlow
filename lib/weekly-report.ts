import { EXCLUDED_PFC } from "@/lib/dashboard";
import {
  applyMerchantRules,
  type MerchantRule,
} from "@/lib/planning";
import type { WeeklyReportPeriod } from "@/lib/report-period";
import { aggregateSpendWithSplits } from "@/lib/transaction-quality";

export interface WeeklyReportTransaction {
  id: string;
  date: string;
  amount: number;
  merchantName: string | null;
  name: string | null;
  category: string | null;
  accountId: string;
  displayCategory?: string | null;
  cashFlowClassification?: "expense" | "income" | null;
}

export interface WeeklyReportAccount {
  id: string;
  name: string | null;
  type: string | null;
  plaidItemId: string;
}

export interface WeeklyReportInput {
  userId: string;
  userEmail: string;
  period: WeeklyReportPeriod;
  transactions: WeeklyReportTransaction[];
  accounts: WeeklyReportAccount[];
  institutions: Array<{ id: string; name: string | null }>;
  budgets: Array<{ category: string; monthlyLimit: number }>;
  merchantRules: MerchantRule[];
  splits: Array<{ transactionId: string; category: string; amount: number }>;
  linkedRefundTransactionIds: Set<string>;
  duplicateTransactionIds: Set<string>;
}

export interface WeeklyReportData {
  userId: string;
  userEmail: string;
  period: WeeklyReportPeriod;
  totalSpend: number;
  previousTotalSpend: number;
  changeAmount: number;
  changePercent: number | null;
  categories: Array<{ category: string; amount: number; share: number }>;
  merchants: Array<{ merchant: string; amount: number }>;
  banks: Array<{ name: string; amount: number }>;
  cards: Array<{ name: string; amount: number }>;
  budgets: Array<{
    category: string;
    spent: number;
    /**
     * The spend ceiling for this report's period: the full monthly limit for a
     * monthly review, the weekly proration (`monthlyLimit * 12 / 52`) for the
     * weekly cadence. `percentage` and `status` are measured against it.
     */
    allowance: number;
    percentage: number;
    status: "on-track" | "at-risk" | "over";
  }>;
  cashFlow: { inflows: number; outflows: number; net: number };
}

// Plaid hands back whatever the bank calls the account, which for one Chase card
// is the literal string "CREDIT CARD". Alone that names nothing, so always carry
// the institution. Only rewrite the casing of a name that is entirely uppercase:
// "Platinum Card®" and "Blue Cash Preferred®" are already how the issuer writes
// them, and a blind title-case would mangle them.
export function formatCardLabel(
  accountName: string | null | undefined,
  institutionName: string | null | undefined,
): string {
  const name = accountName?.trim();
  const institution = institutionName?.trim();
  const shouting = !!name && !/[a-z]/.test(name) && /[A-Z]/.test(name);
  let label = "Credit card";
  if (name) {
    label = shouting
      ? name.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      : name;
  }
  return institution ? `${institution} · ${label}` : label;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * A projected report row. `category` is what the reader sees (the user's
 * display override wins); `flowCategory` is the provider/merchant-rule
 * category that decides spend-vs-transfer, and `spendAmount` is the signed
 * amount to accumulate when the row counts as spending.
 */
interface WeeklyReportRow extends WeeklyReportTransaction {
  merchantName: string | null;
  flowCategory: string | null;
  spendAmount: number;
}

/**
 * Whether a row counts toward spending.
 *
 * The transfer/loan exclusion is tested against `flowCategory`, never the
 * display category: relabelling a credit-card payment "Shopping" changes how
 * it is grouped, but must not turn it into spending, or the payment is
 * double-counted against the purchases it settles. This mirrors
 * projectFinanceTransactions, which keeps the same separation so every
 * surface agrees. Only an explicit cash-flow override reclassifies a row.
 */
function isSpend(transaction: WeeklyReportRow): boolean {
  if (transaction.cashFlowClassification === "income") return false;
  if (transaction.cashFlowClassification === "expense") {
    return transaction.amount !== 0;
  }
  return (
    transaction.amount > 0 &&
    !EXCLUDED_PFC.has(transaction.flowCategory ?? "")
  );
}

/**
 * The amount a row contributes to spend totals. An explicit expense override
 * always contributes an outflow, so a negative-amount row forced to Spending
 * adds to the total instead of silently subtracting from it.
 */
function spendAmountOf(transaction: WeeklyReportTransaction): number {
  return transaction.cashFlowClassification === "expense"
    ? Math.abs(transaction.amount)
    : transaction.amount;
}

function sumByName(
  transactions: WeeklyReportRow[],
  getName: (transaction: WeeklyReportRow) => string | null,
): Array<{ name: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    const name = getName(transaction);
    if (!name) continue;
    totals.set(name, (totals.get(name) ?? 0) + transaction.spendAmount);
  }
  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export function buildWeeklyReportModel(
  input: WeeklyReportInput,
): WeeklyReportData {
  const accountById = new Map(
    input.accounts.map((account) => [account.id, account]),
  );
  const institutionById = new Map(
    input.institutions.map((institution) => [
      institution.id,
      institution.name ?? "Other bank",
    ]),
  );

  const cleanup = input.transactions.map((transaction) => ({
    id: transaction.id,
    merchant: transaction.merchantName ?? transaction.name ?? "Unknown merchant",
    name: transaction.name,
    category: transaction.category,
    accountName: accountById.get(transaction.accountId)?.name ?? "",
  }));
  const applied = applyMerchantRules(cleanup, input.merchantRules);
  const transactions: WeeklyReportRow[] = input.transactions.map(
    (transaction, index) => ({
      ...transaction,
      merchantName: applied[index]!.merchant,
      category: transaction.displayCategory ?? applied[index]!.category,
      flowCategory: applied[index]!.category,
      spendAmount: spendAmountOf(transaction),
    }),
  );

  const usableForSpend = transactions.filter(
    (transaction) =>
      !input.linkedRefundTransactionIds.has(transaction.id) &&
      !input.duplicateTransactionIds.has(transaction.id),
  );
  const currentSpend = usableForSpend.filter(
    (transaction) =>
      transaction.date >= input.period.start &&
      transaction.date <= input.period.end &&
      isSpend(transaction),
  );
  const previousSpend = usableForSpend.filter(
    (transaction) =>
      transaction.date >= input.period.previousStart &&
      transaction.date <= input.period.previousEnd &&
      isSpend(transaction),
  );

  const totalSpend = round2(
    currentSpend.reduce((sum, transaction) => sum + transaction.spendAmount, 0),
  );
  const previousTotalSpend = round2(
    previousSpend.reduce((sum, transaction) => sum + transaction.spendAmount, 0),
  );
  const changeAmount = round2(totalSpend - previousTotalSpend);

  const categoryTotals = aggregateSpendWithSplits(
    currentSpend.map((transaction) => ({
      id: transaction.id,
      amount: transaction.spendAmount,
      category: transaction.category,
    })),
    input.splits,
  );
  const categories = categoryTotals.map((category) => ({
    ...category,
    share: totalSpend > 0 ? round4(category.amount / totalSpend) : 0,
  }));

  const merchantTotals = new Map<string, number>();
  for (const transaction of currentSpend) {
    const merchant = transaction.merchantName ?? transaction.name ?? "Unknown merchant";
    merchantTotals.set(
      merchant,
      (merchantTotals.get(merchant) ?? 0) + transaction.spendAmount,
    );
  }
  const merchants = [...merchantTotals.entries()]
    .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant))
    .slice(0, 5);

  const banks = sumByName(currentSpend, (transaction) => {
    const account = accountById.get(transaction.accountId);
    return account
      ? (institutionById.get(account.plaidItemId) ?? "Other bank")
      : "Other bank";
  });
  const cards = sumByName(
    currentSpend.filter(
      (transaction) => accountById.get(transaction.accountId)?.type === "credit",
    ),
    (transaction) => {
      const account = accountById.get(transaction.accountId);
      return formatCardLabel(
        account?.name,
        account ? (institutionById.get(account.plaidItemId) ?? null) : null,
      );
    },
  );

  const categoryAmount = new Map(
    categories.map((category) => [category.category, category.amount]),
  );
  // A monthly review measures spend against the whole monthly limit; the
  // weekly cadence prorates it (`* 12 / 52`). Using the weekly number for a
  // month of spend marked every ordinary budget as ~4x over.
  const isMonthlyPeriod = input.period.kind === "monthly";
  const budgets = input.budgets
    .map((budget) => {
      const spent = round2(categoryAmount.get(budget.category) ?? 0);
      const allowance = round2(
        isMonthlyPeriod ? budget.monthlyLimit : (budget.monthlyLimit * 12) / 52,
      );
      let percentage = 0;
      if (allowance > 0) percentage = round2(spent / allowance);
      else if (spent > 0) percentage = 1;
      let status: "on-track" | "at-risk" | "over" = "on-track";
      if (percentage > 1) status = "over";
      else if (percentage >= 0.85) status = "at-risk";
      return {
        category: budget.category,
        spent,
        allowance,
        percentage,
        status,
      };
    })
    .sort((a, b) => b.percentage - a.percentage || a.category.localeCompare(b.category));

  let inflows = 0;
  let outflows = 0;
  for (const transaction of transactions) {
    if (
      transaction.date < input.period.start ||
      transaction.date > input.period.end ||
      input.duplicateTransactionIds.has(transaction.id) ||
      accountById.get(transaction.accountId)?.type !== "depository"
    ) {
      continue;
    }
    if (transaction.cashFlowClassification === "income") {
      inflows += Math.abs(transaction.amount);
    } else if (transaction.cashFlowClassification === "expense") {
      outflows += Math.abs(transaction.amount);
    } else {
      if (transaction.amount < 0) inflows += Math.abs(transaction.amount);
      if (transaction.amount > 0) outflows += transaction.amount;
    }
  }

  return {
    userId: input.userId,
    userEmail: input.userEmail,
    period: input.period,
    totalSpend,
    previousTotalSpend,
    changeAmount,
    changePercent:
      previousTotalSpend > 0 ? round4(changeAmount / previousTotalSpend) : null,
    categories,
    merchants,
    banks,
    cards,
    budgets,
    cashFlow: {
      inflows: round2(inflows),
      outflows: round2(outflows),
      net: round2(inflows - outflows),
    },
  };
}
