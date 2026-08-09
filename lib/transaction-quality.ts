export interface SplitTransaction {
  id: string;
  amount: number;
  category: string | null;
}

export interface TransactionSplit {
  transactionId: string;
  category: string;
  amount: number;
}

export interface LedgerTransaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
}

export interface ReviewAnomaly {
  kind: "duplicate" | "refund";
  subjectId: string;
  message: string;
}

export interface ReviewDecision {
  kind: "duplicate" | "refund";
  subjectId: string;
  decision: "confirmed" | "dismissed";
}

export interface DuplicateTransaction extends LedgerTransaction {
  accountId: string;
  plaidItemId: string | null;
  accountName: string;
}

export interface DuplicatePair {
  subjectId: string;
  first: DuplicateTransaction;
  second: DuplicateTransaction;
  dateDistanceDays: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDate(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function validateSplits(transaction: SplitTransaction, splits: TransactionSplit[]) {
  const total = splits
    .filter((split) => split.transactionId === transaction.id)
    .reduce((sum, split) => sum + split.amount, 0);
  const difference = round2(Math.abs(transaction.amount) - total);

  return {
    valid: Math.abs(difference) < 0.01,
    difference,
  };
}

export function aggregateSpendWithSplits(
  transactions: SplitTransaction[],
  splits: TransactionSplit[],
): { category: string; amount: number }[] {
  const splitsByTransaction = new Map<string, TransactionSplit[]>();
  for (const split of splits) {
    const rows = splitsByTransaction.get(split.transactionId) ?? [];
    rows.push(split);
    splitsByTransaction.set(split.transactionId, rows);
  }

  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    const rows = splitsByTransaction.get(transaction.id);
    if (rows && validateSplits(transaction, rows).valid) {
      for (const split of rows) {
        totals.set(split.category, (totals.get(split.category) ?? 0) + split.amount);
      }
    } else {
      totals.set(transaction.category ?? "UNCATEGORIZED", (totals.get(transaction.category ?? "UNCATEGORIZED") ?? 0) + Math.abs(transaction.amount));
    }
  }

  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

export function detectRefundPairs(transactions: LedgerTransaction[], windowDays: number) {
  const pairs: { chargeId: string; refundId: string; amount: number }[] = [];
  const charges = transactions.filter((txn) => txn.amount > 0);
  const refunds = transactions.filter((txn) => txn.amount < 0);
  const usedRefunds = new Set<string>();

  for (const charge of charges) {
    const chargeDate = parseDate(charge.date);
    const refund = refunds.find((candidate) => {
      if (usedRefunds.has(candidate.id)) return false;
      if (normalize(candidate.merchant) !== normalize(charge.merchant)) return false;
      if (round2(Math.abs(candidate.amount)) !== round2(charge.amount)) return false;
      const days = Math.abs(parseDate(candidate.date) - chargeDate) / 86_400_000;
      return days <= windowDays;
    });
    if (!refund) continue;
    usedRefunds.add(refund.id);
    pairs.push({ chargeId: charge.id, refundId: refund.id, amount: round2(charge.amount) });
  }

  return pairs;
}

export function duplicateSubjectId(firstId: string, secondId: string): string {
  return [firstId, secondId].sort((left, right) => left.localeCompare(right)).join(":");
}

function evaluateDuplicateCandidate(
  first: DuplicateTransaction,
  second: DuplicateTransaction,
  resolved: Set<string>,
): DuplicatePair | null {
  if (first.accountId === second.accountId) return null;
  if (round2(first.amount) !== round2(second.amount)) return null;
  if (normalize(first.merchant) !== normalize(second.merchant)) return null;
  const dateDistanceDays = Math.abs(parseDate(first.date) - parseDate(second.date)) / 86_400_000;
  if (dateDistanceDays > 2) return null;
  const subjectId = duplicateSubjectId(first.id, second.id);
  if (resolved.has(subjectId)) return null;
  return { subjectId, first, second, dateDistanceDays };
}

export function detectDuplicatePairs(
  transactions: DuplicateTransaction[],
  decisions: ReviewDecision[],
): DuplicatePair[] {
  const resolved = new Set(
    decisions
      .filter((decision) => decision.kind === "duplicate")
      .map((decision) => decision.subjectId),
  );
  const candidates: DuplicatePair[] = [];
  const expenses = transactions.filter((transaction) => transaction.amount > 0);
  for (let firstIndex = 0; firstIndex < expenses.length; firstIndex += 1) {
    const first = expenses[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < expenses.length; secondIndex += 1) {
      const second = expenses[secondIndex]!;
      const candidate = evaluateDuplicateCandidate(first, second, resolved);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((left, right) =>
    left.dateDistanceDays - right.dateDistanceDays ||
    normalize(left.first.merchant).localeCompare(normalize(right.first.merchant)) ||
    left.first.amount - right.first.amount ||
    left.subjectId.localeCompare(right.subjectId),
  );
  const used = new Set<string>();
  return candidates.filter((candidate) => {
    if (used.has(candidate.first.id) || used.has(candidate.second.id)) return false;
    used.add(candidate.first.id);
    used.add(candidate.second.id);
    return true;
  });
}

export function filterReviewDecisions(anomalies: ReviewAnomaly[], decisions: ReviewDecision[]): ReviewAnomaly[] {
  const dismissed = new Set(
    decisions
      .filter((decision) => decision.decision === "dismissed")
      .map((decision) => `${decision.kind}:${decision.subjectId}`),
  );
  return anomalies.filter((anomaly) => !dismissed.has(`${anomaly.kind}:${anomaly.subjectId}`));
}
