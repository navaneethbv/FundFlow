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
