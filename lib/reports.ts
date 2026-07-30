export interface ReportRow {
  date: string; // ISO date
  amount: number; // cents
  category: string;
  type: 'income' | 'expense';
}

/** Simple aggregation helpers for cash‑flow, spending and income */
export function aggregateCashFlow(rows: ReportRow[]) {
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return { total };
}

export function aggregateSpending(rows: ReportRow[]) {
  const total = rows.filter((r) => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
  return { total };
}

export function aggregateIncome(rows: ReportRow[]) {
  const total = rows.filter((r) => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
  return { total };
}
