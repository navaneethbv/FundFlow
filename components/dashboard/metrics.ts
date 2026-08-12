export type BalanceAccount = {
  type: string | null;
  current_balance: number | null;
};

export function computeNetWorth(accounts: BalanceAccount[]): number {
  return Math.round(
    accounts.reduce((sum, account) => {
      const balance = account.current_balance ?? 0;
      if (account.type === "credit" || account.type === "loan") return sum - balance;
      return sum + balance;
    }, 0) * 100,
  ) / 100;
}

export function netWorthDeltaFromHistory(
  netWorth: number,
  history: { month: string; netWorth: number }[],
): number | undefined {
  const previousSnapshot = history.length > 1 ? history.at(-2) : undefined;
  return previousSnapshot ? netWorth - previousSnapshot.netWorth : undefined;
}

export function computeSavingsRate(income: number, spending: number): number {
  if (income <= 0) return 0;
  const savings = income - spending;
  if (savings <= 0) return 0;
  return Math.round((savings / income) * 100);
}
