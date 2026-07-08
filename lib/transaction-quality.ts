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

export function filterReviewDecisions(anomalies: ReviewAnomaly[], decisions: ReviewDecision[]): ReviewAnomaly[] {
  const dismissed = new Set(
    decisions
      .filter((decision) => decision.decision === "dismissed")
      .map((decision) => `${decision.kind}:${decision.subjectId}`),
  );
  return anomalies.filter((anomaly) => !dismissed.has(`${anomaly.kind}:${anomaly.subjectId}`));
}
