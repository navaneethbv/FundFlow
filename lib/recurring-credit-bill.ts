/**
 * Credit-card bill bucket for the Recurring page. Populated only from real
 * bill data (statement balances); purchases charged to a card remain Expenses
 * and the bill payment itself is a transfer, so the bucket never double-counts
 * a bill payment as spending.
 */

export interface CreditCardBill {
  accountId: string;
  statementBalance: number | null;
  minimumPayment: number | null;
  dueDate: string | null;
}

export interface CreditCardBucket {
  paid: number;
  remaining: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Sum the statement balances of bills due in `month` (YYYY-MM). The bucket
 * reports the amount owed as `remaining`; `paid` stays zero because FundFlow
 * does not yet track which bill installments were paid from a payment account.
 * An empty bucket means no real bill data exists.
 */
export function buildCreditCardBucket(
  bills: CreditCardBill[],
  month: string,
): CreditCardBucket {
  let remaining = 0;
  for (const bill of bills) {
    if (!bill.statementBalance) continue;
    if (bill.dueDate?.startsWith(month) !== true) continue;
    remaining = round2(remaining + bill.statementBalance);
  }
  return { paid: 0, remaining };
}
