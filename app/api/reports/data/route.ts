import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/http';
import type { ReportRow } from '@/lib/reports';

/**
 * GET /api/reports/data
 * Returns a sample list of ReportRow objects for the Reports UI.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  // In a real implementation this would query the database.
  const sample: ReportRow[] = [
    { date: '2024-01-01', amount: 12345, category: 'Salary', type: 'income' },
    { date: '2024-01-05', amount: -5432, category: 'Groceries', type: 'expense' },
    { date: '2024-01-10', amount: -2500, category: 'Rent', type: 'expense' },
  ];
  return NextResponse.json({ rows: sample });
}
