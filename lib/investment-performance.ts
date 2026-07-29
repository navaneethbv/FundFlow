export interface CashFlowEvent {
  date: string;
  amount: number; // positive = deposit into investment, negative = withdrawal
}

export function computeTimeWeightedReturn(
  startValue: number,
  endValue: number,
  cashFlows: CashFlowEvent[] = [],
): number {
  if (startValue <= 0) return 0;

  let netFlows = 0;
  for (const cf of cashFlows) {
    netFlows += cf.amount;
  }

  const adjustedEnd = endValue - netFlows;
  const twr = ((adjustedEnd - startValue) / startValue) * 100;
  return Math.round(twr * 100) / 100;
}
