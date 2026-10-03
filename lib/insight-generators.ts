import {
  TRANSFER_GROUPS as EXCLUDED_PFC,
  type CanonicalFinanceTransaction,
} from "@/lib/finance-domain";
import { addDays, addMonths, parseDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format";

import type { InsightType } from "@/lib/insight-types";
export interface Insight {
  type: InsightType;
  subjectKey: string;
  details: { title: string; body: string };
}
export interface InsightInputs {
  today: string;
  /** Start of the loaded history, not a claim of provider completeness. */
  historyStart: string;
  transactions: CanonicalFinanceTransaction[];
  bills: {
    id: string;
    name: string;
    dueDate: string;
    amount: number;
    overdue: boolean;
  }[];
  accounts: {
    id: string;
    name: string;
    balance: number | null;
    opened: string;
    lastActivity: string | null;
  }[];
  reserves: { id: string; name: string; target: number; funded: number }[];
}
function insight(
  type: InsightType,
  key: string,
  title: string,
  body: string,
): Insight {
  return { type, subjectKey: `${type}:${key}`, details: { title, body } };
}
function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = key(row);
    const members = groups.get(group);
    if (members) members.push(row);
    else groups.set(group, [row]);
  }
  return groups;
}
/** Descriptor grouping is heuristic, never a relational join or merchant identity. */
function merchantPairSignals(
  ordered: CanonicalFinanceTransaction[],
  recent: string,
): Insight[] {
  const out: Insight[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const row = ordered[i]!;
    const previous = ordered[i - 1]!;
    if (row.date < recent) continue;
    if (
      row.accountId === previous.accountId &&
      row.manualAccountId === previous.manualAccountId &&
      row.date <= addDays(previous.date, 2) &&
      Math.round(row.signedAmount * 100) === Math.round(previous.signedAmount * 100)
    ) {
      out.push(
        insight(
          "double_charge",
          `${previous.sourceTransactionId}:${row.sourceTransactionId}`,
          "Check two adjacent charges",
          `${row.merchant}: two ${formatCurrency(row.signedAmount)} charges on ${previous.date} and ${row.date}, on the same account. They may both be valid.`,
        ),
      );
    }
    const earlier = ordered.slice(0, i).filter((prior) => prior.date < row.date);
    if (earlier.length < 3) continue;
    const usual = median(earlier.map((prior) => prior.signedAmount));
    if (row.signedAmount < 50 || row.signedAmount < usual * 3) continue;
    out.push(
      insight(
        "merchant_spike",
        row.sourceTransactionId,
        "Larger than this merchant's usual charge",
        `${row.merchant}: ${formatCurrency(row.signedAmount)}, compared with a median ${formatCurrency(usual)} across ${earlier.length} earlier purchases in loaded history.`,
      ),
    );
  }
  return out;
}

function merchantGroupSignals(
  group: CanonicalFinanceTransaction[],
  input: InsightInputs,
  recent: string,
): Insight[] {
  if (!group[0]?.merchant.trim()) return [];
  const ordered = group.toSorted(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sourceTransactionId.localeCompare(b.sourceTransactionId),
  );
  const first = ordered[0]!;
  const out = merchantPairSignals(ordered, recent);
  if (first.date >= recent && first.signedAmount >= 100)
    out.unshift(
      insight(
        "new_merchant",
        first.sourceTransactionId,
        "A merchant new to this history",
        `${first.merchant}: ${formatCurrency(first.signedAmount)} on ${first.date}. No earlier purchase with this descriptor since ${input.historyStart}.`,
      ),
    );
  return out;
}

function merchantSignals(
  rows: CanonicalFinanceTransaction[],
  input: InsightInputs,
): Insight[] {
  const recent = addDays(input.today, -6);
  const purchases = rows.filter((row) => row.signedAmount > 0);
  const out: Insight[] = [];
  for (const group of groupBy(purchases, (row) => row.merchant.trim().toLowerCase()).values())
    out.push(...merchantGroupSignals(group, input, recent));
  return out;
}
function categorySignals(
  rows: CanonicalFinanceTransaction[],
  input: InsightInputs,
): Insight[] {
  const start = input.today.slice(0, 7) + "-01";
  if (input.historyStart > addMonths(start, -3)) return [];
  const elapsed = Number(input.today.slice(8));
  const monthDays = parseDate(addDays(addMonths(start, 1), -1)).getUTCDate();
  const out: Insight[] = [];
  for (const [category, group] of groupBy(rows, (row) => row.categoryKey)) {
    const current = group
      .filter((row) => row.date >= start)
      .reduce((sum, row) => sum + row.signedAmount, 0);
    const baseline =
      group
        .filter((row) => row.date < start)
        .reduce((sum, row) => sum + row.signedAmount, 0) / 3;
    const paced = (baseline * elapsed) / monthDays;
    if (
      baseline > 0 &&
      current >= 100 &&
      current >= paced * 1.5 &&
      current - paced >= 50
    ) {
      out.push(
        insight(
          "category_spike",
          `${category}:${start}`,
          "Category spending is ahead of its usual pace",
          `${category}: ${formatCurrency(current)} through day ${elapsed}, versus ${formatCurrency(paced)} at the pace of the prior three full calendar months (monthly average ${formatCurrency(baseline)}). Refunds reduce spending.`,
        ),
      );
    }
  }
  return out;
}
function savingsSignal(input: InsightInputs): Insight[] {
  const start = input.today.slice(0, 7) + "-01";
  const prior = addMonths(start, -2);
  if (input.historyStart > prior) return [];
  const rates = [prior, addMonths(start, -1)].map((month) => {
    const rows = input.transactions.filter(
      (row) =>
        !row.pending &&
        row.date >= month &&
        row.date < addMonths(month, 1) &&
        !EXCLUDED_PFC.has(row.groupKey),
    );
    const income = -rows
      .filter((row) => row.flow === "income")
      .reduce((sum, row) => sum + row.signedAmount, 0);
    const spent = rows
      .filter((row) => row.flow === "expense")
      .reduce((sum, row) => sum + row.signedAmount, 0);
    return income > 0 ? ((income - spent) / income) * 100 : null;
  });
  const [before, after] = rates;
  if (before == null || after == null || Math.abs(after - before) < 5)
    return [];
  return [
    insight(
      "savings_rate_change",
      start,
      "Your savings rate changed",
      `The last two full calendar months show ${before.toFixed(1)}% then ${after.toFixed(1)}%, a ${(after - before).toFixed(1)} percentage-point change. Based on loaded income and net spending; the current partial month is excluded.`,
    ),
  ];
}
export function generateInsights(input: InsightInputs): Insight[] {
  const start = input.today.slice(0, 7) + "-01";
  const validRows = input.transactions.filter(
    (row) =>
      !row.pending &&
      row.date >= addMonths(start, -3) &&
      row.date <= input.today &&
      row.flow === "expense" &&
      !EXCLUDED_PFC.has(row.groupKey),
  );
  // A split must not become two apparent bank charges.
  const parentRows = [
    ...groupBy(validRows, (row) => row.sourceTransactionId).values(),
  ].map((rows) => ({
    ...rows[0]!,
    signedAmount: rows.reduce((sum, row) => sum + row.signedAmount, 0),
  }));
  const out = [
    ...merchantSignals(parentRows, input),
    ...categorySignals(validRows, input),
    ...savingsSignal(input),
  ];
  for (const bill of input.bills) {
    if (!bill.overdue || bill.dueDate >= input.today || bill.amount <= 0)
      continue;
    out.push(
      insight(
        "bill_overdue",
        `${bill.id}:${bill.dueDate}`,
        "A bill has no recorded payment",
        `${bill.name}: ${formatCurrency(bill.amount)} was due ${bill.dueDate}. No linked payment is recorded; check before paying again.`,
      ),
    );
  }
  for (const account of input.accounts) {
    if (
      account.balance == null ||
      account.balance < 5000 ||
      account.opened > addDays(input.today, -60) ||
      (account.lastActivity &&
        account.lastActivity >= addDays(input.today, -60))
    )
      continue;
    out.push(
      insight(
        "idle_cash",
        `${account.id}:${start}`,
        "Cash with no recent recorded movement",
        `${account.name} holds ${formatCurrency(account.balance)} with no recorded activity in 60 days. This may be intentional reserve money.`,
      ),
    );
  }
  for (const goal of input.reserves) {
    if (goal.target <= 0 || goal.funded >= goal.target) continue;
    out.push(
      insight(
        "goal_reserve_depleted",
        `${goal.id}:${start}`,
        "A reserve is below its target",
        `${goal.name}: ${formatCurrency(goal.funded)} funded against ${formatCurrency(goal.target)}, a gap of ${formatCurrency(goal.target - goal.funded)}.`,
      ),
    );
  }
  return out;
}
