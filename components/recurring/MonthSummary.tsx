import React from 'react';
import { formatCurrency } from '@/lib/format';

interface MonthSummaryProps {
  month: string; // YYYY-MM
  totalAmount: number; // in cents
  recurringCount: number;
}

export default function MonthSummary({ month, totalAmount, recurringCount }: MonthSummaryProps) {
  const formatted = formatCurrency(totalAmount / 100);
  return (
    <div className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 p-4 text-white shadow-lg">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{month}</h3>
        <span className="text-2xl font-bold">{formatted}</span>
      </div>
      <p className="mt-1 text-sm opacity-90">
        {recurringCount} recurring transaction{recurringCount !== 1 && 's'} this month
      </p>
    </div>
  );
}

