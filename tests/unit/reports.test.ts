import { describe, it, expect } from 'vitest';
import { aggregateCashFlow, aggregateSpending, aggregateIncome, type ReportRow } from '@/lib/reports';

const rows: ReportRow[] = [
  { date: '2024-01-01', amount: 10000, category: 'Salary', type: 'income' },
  { date: '2024-01-05', amount: -3000, category: 'Groceries', type: 'expense' },
  { date: '2024-01-10', amount: -2000, category: 'Rent', type: 'expense' },
  { date: '2024-01-15', amount: 5000, category: 'Freelance', type: 'income' },
];

describe('reports lib', () => {
  it('aggregateCashFlow sums all amounts', () => {
    expect(aggregateCashFlow(rows).total).toBe(10000);
  });

  it('aggregateSpending sums only expenses', () => {
    expect(aggregateSpending(rows).total).toBe(-5000);
  });

  it('aggregateIncome sums only income', () => {
    expect(aggregateIncome(rows).total).toBe(15000);
  });

  it('handles empty array', () => {
    expect(aggregateCashFlow([]).total).toBe(0);
    expect(aggregateSpending([]).total).toBe(0);
    expect(aggregateIncome([]).total).toBe(0);
  });
});
