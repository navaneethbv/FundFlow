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
    weeklyAllowance: number;
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
  const label = name
    ? shouting
      ? name
          .toLowerCase()
          .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      : name
    : "Credit card";
  return institution ? `${institution} · ${label}` : label;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isSpend(transaction: WeeklyReportTransaction): boolean {
  return (
    transaction.amount > 0 &&
    !EXCLUDED_PFC.has(transaction.category ?? "")
  );
}

function sumByName(
  transactions: WeeklyReportTransaction[],
  getName: (transaction: WeeklyReportTransaction) => string | null,
): Array<{ name: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    const name = getName(transaction);
    if (!name) continue;
    totals.set(name, (totals.get(name) ?? 0) + transaction.amount);
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
    category: transaction.category,
    accountName: accountById.get(transaction.accountId)?.name ?? "",
  }));
  const applied = applyMerchantRules(cleanup, input.merchantRules);
  const transactions = input.transactions.map((transaction, index) => ({
    ...transaction,
    merchantName: applied[index]!.merchant,
    category: applied[index]!.category,
  }));

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
    currentSpend.reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const previousTotalSpend = round2(
    previousSpend.reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const changeAmount = round2(totalSpend - previousTotalSpend);

  const categoryTotals = aggregateSpendWithSplits(
    currentSpend.map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount,
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
      (merchantTotals.get(merchant) ?? 0) + transaction.amount,
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
        account ? institutionById.get(account.plaidItemId) : null,
      );
    },
  );

  const categoryAmount = new Map(
    categories.map((category) => [category.category, category.amount]),
  );
  const budgets = input.budgets
    .map((budget) => {
      const spent = round2(categoryAmount.get(budget.category) ?? 0);
      const weeklyAllowance = round2((budget.monthlyLimit * 12) / 52);
      const percentage =
        weeklyAllowance > 0 ? round2(spent / weeklyAllowance) : spent > 0 ? 1 : 0;
      return {
        category: budget.category,
        spent,
        weeklyAllowance,
        percentage,
        status: (percentage > 1
          ? "over"
          : percentage >= 0.85
            ? "at-risk"
            : "on-track") as "on-track" | "at-risk" | "over",
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
    if (transaction.amount < 0) inflows += Math.abs(transaction.amount);
    if (transaction.amount > 0) outflows += transaction.amount;
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
