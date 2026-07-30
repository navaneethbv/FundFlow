import { describe, it, expect } from 'vitest';
import { runMonteCarloForecast } from '@/lib/forecasting';
import type { ForecastInput } from '@/lib/planning';

describe('forecasting lib', () => {
  const input: ForecastInput = {
    startingBalance: 5000,
    asOf: '2024-06-01',
    horizonDays: 30,
    lowBalanceThreshold: 500,
    items: [
      { name: 'Salary', amount: 3000, itemType: 'income', frequency: 'monthly', nextDate: '2024-06-15' },
      { name: 'Rent', amount: 1500, itemType: 'expense', frequency: 'monthly', nextDate: '2024-06-01' },
    ],
  };

  it('returns a CashFlowForecast', () => {
    const result = runMonteCarloForecast(input, 50, 0);
    expect(result).toHaveProperty('projectedBalance');
    expect(result).toHaveProperty('lowBalanceRisk');
    expect(result).toHaveProperty('lowestBalance');
    expect(result).toHaveProperty('assumptions');
    expect(result).toHaveProperty('events');
  });

  it('events are sorted by date', () => {
    const result = runMonteCarloForecast(input, 10, 0);
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.date >= result.events[i - 1]!.date).toBe(true);
    }
  });

  it('detects low-balance risk when threshold is high', () => {
    const risky: ForecastInput = { ...input, lowBalanceThreshold: 100000 };
    const result = runMonteCarloForecast(risky, 50, 0);
    expect(result.lowBalanceRisk).toBe(true);
  });

  it('returns false for low-balance risk when threshold is low', () => {
    const safe: ForecastInput = { ...input, lowBalanceThreshold: 0 };
    const result = runMonteCarloForecast(safe, 50, 0);
    expect(result.lowBalanceRisk).toBe(false);
  });

  it('handles zero jitter deterministically', () => {
    const a = runMonteCarloForecast(input, 10, 0);
    const b = runMonteCarloForecast(input, 10, 0);
    expect(a.projectedBalance).toBe(b.projectedBalance);
  });
});
