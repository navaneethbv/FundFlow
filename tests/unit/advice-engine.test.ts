import { describe, it, expect } from 'vitest';
import { generateAdvice, type AdviceInput } from '@/lib/advice';

describe('advice engine', () => {
  const base: AdviceInput = {
    monthlyIncome: 6000,
    monthlySpend: 4000,
    savingsRate: 0.15,
    emergencyFundMonths: 4,
    debtToIncomeRatio: 0.15,
    goalCount: 2,
    hasInvestments: true,
  };

  it('returns empty advice for a healthy profile', () => {
    const items = generateAdvice(base);
    // healthy profile should only get "Great savings rate" tip
    expect(items.every((i) => i.severity === 'tip')).toBe(true);
  });

  it('warns about low emergency fund', () => {
    const items = generateAdvice({ ...base, emergencyFundMonths: 1.5 });
    expect(items.some((i) => i.title.includes('emergency fund'))).toBe(true);
  });

  it('critical when emergency fund < 1 month', () => {
    const items = generateAdvice({ ...base, emergencyFundMonths: 0.5 });
    const ef = items.find((i) => i.title.includes('emergency fund'));
    expect(ef?.severity).toBe('critical');
  });

  it('warns about low savings rate', () => {
    const items = generateAdvice({ ...base, savingsRate: 0.07 });
    expect(items.some((i) => i.title.includes('savings rate'))).toBe(true);
  });

  it('flags high debt-to-income', () => {
    const items = generateAdvice({ ...base, debtToIncomeRatio: 0.40 });
    expect(items.some((i) => i.title.includes('debt-to-income'))).toBe(true);
  });

  it('suggests setting a goal when goalCount is 0', () => {
    const items = generateAdvice({ ...base, goalCount: 0 });
    expect(items.some((i) => i.title.includes('Set a financial goal'))).toBe(true);
  });

  it('suggests investing when savings is good but no investments', () => {
    const items = generateAdvice({ ...base, hasInvestments: false });
    expect(items.some((i) => i.title.includes('Consider investing'))).toBe(true);
  });

  it('critical when spending exceeds income', () => {
    const items = generateAdvice({ ...base, monthlySpend: 7000 });
    const spending = items.find((i) => i.title.includes('exceeds income'));
    expect(spending?.severity).toBe('critical');
  });
});
