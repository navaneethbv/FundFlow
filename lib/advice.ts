/**
 * Rule-based financial advice engine.
 * Generates personalized recommendations from goals, cash-flow, and spending data.
 */

export type AdviceSeverity = 'tip' | 'warning' | 'critical';

export interface AdviceItem {
  id: string;
  title: string;
  body: string;
  severity: AdviceSeverity;
  category: string;
}

export interface AdviceInput {
  monthlyIncome: number;
  monthlySpend: number;
  savingsRate: number; // 0-1
  emergencyFundMonths: number; // how many months of expenses are saved
  debtToIncomeRatio: number; // 0-1
  goalCount: number;
  hasInvestments: boolean;
}

export function generateAdvice(input: AdviceInput): AdviceItem[] {
  const items: AdviceItem[] = [];
  let id = 0;

  // Emergency fund
  if (input.emergencyFundMonths < 3) {
    items.push({
      id: String(++id),
      title: 'Build your emergency fund',
      body: `You have ${input.emergencyFundMonths.toFixed(1)} months of expenses saved. Aim for at least 3–6 months.`,
      severity: input.emergencyFundMonths < 1 ? 'critical' : 'warning',
      category: 'Savings',
    });
  }

  // Savings rate
  if (input.savingsRate < 0.1) {
    items.push({
      id: String(++id),
      title: 'Increase your savings rate',
      body: `You're saving ${(input.savingsRate * 100).toFixed(0)}% of income. Try to reach at least 10–20%.`,
      severity: input.savingsRate < 0.05 ? 'critical' : 'warning',
      category: 'Savings',
    });
  } else if (input.savingsRate >= 0.2) {
    items.push({
      id: String(++id),
      title: 'Great savings rate!',
      body: `You're saving ${(input.savingsRate * 100).toFixed(0)}% of income. Keep it up!`,
      severity: 'tip',
      category: 'Savings',
    });
  }

  // Debt
  if (input.debtToIncomeRatio > 0.36) {
    items.push({
      id: String(++id),
      title: 'High debt-to-income ratio',
      body: `Your DTI is ${(input.debtToIncomeRatio * 100).toFixed(0)}%. Lenders consider >36% risky.`,
      severity: 'critical',
      category: 'Debt',
    });
  } else if (input.debtToIncomeRatio > 0.2) {
    items.push({
      id: String(++id),
      title: 'Monitor your debt',
      body: `Your DTI is ${(input.debtToIncomeRatio * 100).toFixed(0)}%. Consider paying down balances.`,
      severity: 'warning',
      category: 'Debt',
    });
  }

  // Goals
  if (input.goalCount === 0) {
    items.push({
      id: String(++id),
      title: 'Set a financial goal',
      body: 'Goals help you stay motivated and track progress. Try adding one!',
      severity: 'tip',
      category: 'Goals',
    });
  }

  // Investments
  if (!input.hasInvestments && input.savingsRate >= 0.1) {
    items.push({
      id: String(++id),
      title: 'Consider investing',
      body: 'You have healthy savings. Investing could help your money grow over time.',
      severity: 'tip',
      category: 'Investing',
    });
  }

  // Spending vs income
  if (input.monthlySpend > input.monthlyIncome) {
    items.push({
      id: String(++id),
      title: 'Spending exceeds income',
      body: 'You spent more than you earned this month. Review your expenses to find areas to cut.',
      severity: 'critical',
      category: 'Spending',
    });
  }

  return items;
}
