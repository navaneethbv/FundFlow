import { netWorthContribution } from "@/lib/account-balance";
import { computeSavingsRate as sharedComputeSavingsRate } from "@/lib/finance-metrics";

export type BalanceAccount = {
  type: string | null;
  subtype?: string | null;
  current_balance: number | null;
};

export function computeNetWorth(accounts: BalanceAccount[]): number {
  return (
    Math.round(
      accounts.reduce((sum, account) => {
        return (
          sum +
          netWorthContribution(
            account.current_balance,
            account.type,
            account.subtype,
          )
        );
      }, 0) * 100,
    ) / 100
  );
}

export function netWorthDeltaFromHistory(
  netWorth: number,
  history: { month: string; netWorth: number }[],
): number | undefined {
  const previousSnapshot = history.length > 1 ? history.at(-2) : undefined;
  return previousSnapshot ? netWorth - previousSnapshot.netWorth : undefined;
}

export function computeSavingsRate(
  income: number,
  spending: number,
): number | null {
  return sharedComputeSavingsRate(income, spending);
}

export type DashboardSavingsRateBasis = {
  rate: number | null;
  income: number;
  spending: number;
  month: string | null;
  usesPriorCompleteMonth: boolean;
};

/**
 * Resolve the period shown by the dashboard savings-rate card.
 *
 * The active calendar month is incomplete by definition, so its rate uses the
 * preceding month while the active-month cash-flow tiles continue to show
 * month-to-date values. Historical selections use their selected month.
 */
export function resolveDashboardSavingsRate(input: {
  selectedMonth: string;
  currentMonth: string;
  monthlyIncome: { month: string; amount: number }[];
  monthlySpending: { month: string; amount: number }[];
}): DashboardSavingsRateBasis {
  const selectedIndex = input.monthlyIncome.findIndex(
    (row) => row.month === input.selectedMonth,
  );
  const usesPriorCompleteMonth = input.selectedMonth === input.currentMonth;
  const basisIndex = selectedIndex - (usesPriorCompleteMonth ? 1 : 0);
  const incomeRow = basisIndex >= 0 ? input.monthlyIncome[basisIndex] : undefined;

  if (!incomeRow) {
    return {
      rate: null,
      income: 0,
      spending: 0,
      month: null,
      usesPriorCompleteMonth,
    };
  }

  const income = incomeRow.amount;
  const spending =
    input.monthlySpending.find((row) => row.month === incomeRow.month)?.amount ?? 0;
  return {
    rate: computeSavingsRate(income, spending),
    income,
    spending,
    month: incomeRow.month,
    usesPriorCompleteMonth,
  };
}

/**
 * A dashboard rate is denominator-sensitive when spending is more than ten
 * times the income recorded for the period. The exact signed rate remains
 * available; this flag only tells the UI to explain the small income base.
 */
export function hasSmallSavingsRateBase(
  income: number | null | undefined,
  spending: number | null | undefined,
): boolean {
  const inc = income ?? 0;
  const spend = spending ?? 0;
  return inc > 0 && spend > inc * 10;
}
