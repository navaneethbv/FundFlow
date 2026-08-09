export interface ReceiptMatchInput {
  merchant: string;
  total: number;
  purchaseDate: string;
}

export interface ReceiptTransaction {
  id: string;
  date: string;
  amount: number;
  merchantName?: string | null;
  name?: string | null;
}

export interface ReceiptCandidate {
  transactionId: string;
  date: string;
  amount: number;
  merchant: string;
  amountDifferencePercent: number;
  dateDifferenceDays: number;
  merchantScore: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The ±% band on the receipt total that `findReceiptCandidates` will accept. */
const AMOUNT_TOLERANCE_PERCENT = 1;

/**
 * A PostgREST `.or()` filter for the amount band this matcher accepts, so a
 * caller can push the predicate into the query instead of paging rows into JS
 * and hoping the real match landed inside an unordered row cap.
 *
 * Both signs are covered because the matcher compares `Math.abs(amount)`; a
 * positive-only predicate would silently disagree with it. The extra cent of
 * slack absorbs rounding on stored amounts.
 */
export function receiptAmountBandFilter(total: number): string {
  const factor = AMOUNT_TOLERANCE_PERCENT / 100;
  const low = total * (1 - factor) - 0.01;
  const high = total * (1 + factor) + 0.01;
  return [
    `and(amount.gte.${low},amount.lte.${high})`,
    `and(amount.gte.${-high},amount.lte.${-low})`,
  ].join(",");
}

function parseIsoDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function merchantTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );
}

function merchantSimilarity(expected: string, actual: string): number {
  const expectedTokens = merchantTokens(expected);
  if (expectedTokens.size === 0) return 0;
  const actualTokens = merchantTokens(actual);
  let shared = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) shared += 1;
  }
  return shared / expectedTokens.size;
}

export function findReceiptCandidates(
  input: ReceiptMatchInput,
  transactions: ReceiptTransaction[],
): ReceiptCandidate[] {
  if (!Number.isFinite(input.total) || input.total <= 0) return [];
  const receiptDay = parseIsoDay(input.purchaseDate);
  if (receiptDay === null) return [];

  return transactions
    .flatMap((transaction): ReceiptCandidate[] => {
      const transactionDay = parseIsoDay(transaction.date);
      if (transactionDay === null || !Number.isFinite(transaction.amount)) return [];
      const dateDifferenceDays = Math.abs(transactionDay - receiptDay) / DAY_MS;
      const amountDifferencePercent =
        Math.abs(Math.abs(transaction.amount) - input.total) / input.total * 100;
      if (dateDifferenceDays > 3 || amountDifferencePercent > 1 + Number.EPSILON) {
        return [];
      }
      const merchant = transaction.merchantName?.trim() || transaction.name?.trim() || "Unknown";
      return [{
        transactionId: transaction.id,
        date: transaction.date,
        amount: transaction.amount,
        merchant,
        amountDifferencePercent,
        dateDifferenceDays,
        merchantScore: merchantSimilarity(input.merchant, merchant),
      }];
    })
    .sort((left, right) =>
      right.merchantScore - left.merchantScore ||
      left.amountDifferencePercent - right.amountDifferencePercent ||
      left.dateDifferenceDays - right.dateDifferenceDays ||
      left.transactionId.localeCompare(right.transactionId),
    );
}
