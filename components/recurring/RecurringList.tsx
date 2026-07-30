import React from 'react';
import MonthSummary from '@/components/recurring/MonthSummary';
import ReviewBanner from '@/components/recurring/ReviewBanner';
import { formatCurrency } from '@/lib/format';

interface Stream {
  id: string;
  stream_id: string;
  stream_type: string;
  description: string | null;
  merchant_name: string | null;
  average_amount: number | null; // cents
  last_amount: number | null; // cents
  frequency: string | null;
  status: string | null;
  category: string | null;
  is_active: boolean;
  reviewed_at: string | null;
  dismissed_at: string | null;
  user_amount: number | null;
}

interface RecurringListProps {
  streams: Stream[];
  onAction: (streamId: string, action: string, amount?: number) => void;
}

export default function RecurringList({ streams, onAction }: RecurringListProps) {
  const monthsMap = new Map<string, Stream[]>();
  streams.forEach((s) => {
    const dateStr = s.reviewed_at ?? new Date().toISOString();
    const month = dateStr.slice(0, 7);
    if (!monthsMap.has(month)) monthsMap.set(month, []);
    monthsMap.get(month)!.push(s);
  });
  const sortedMonths = Array.from(monthsMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <div className="space-y-6">
      {sortedMonths.map(([month, monthStreams]) => {
        const total = monthStreams.reduce((sum, s) => sum + (s.user_amount ?? s.last_amount ?? 0), 0);
        const recurringCount = monthStreams.filter((s) => s.is_active).length;
        return (
          <section key={month}>
            <MonthSummary month={month} totalAmount={total} recurringCount={recurringCount} />
            <ul className="mt-4 space-y-2">
              {monthStreams.map((s) => (
                <li key={s.id} className="rounded border p-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="font-medium">{s.merchant_name ?? s.description ?? 'Unnamed'}</h4>
                      <p className="text-sm text-gray-600">{s.category ?? 'Uncategorized'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(((s.user_amount ?? s.last_amount ?? 0) / 100).toFixed(2))}</p>
                      <p className="text-xs text-gray-500">{s.frequency ?? 'One‑off'}</p>
                    </div>
                  </div>
                  {!s.reviewed_at && !s.dismissed_at && (
                    <ReviewBanner
                      streamId={s.id}
                      streamName={s.merchant_name ?? s.description ?? 'Unnamed'}
                      onReview={() => onAction(s.id, 'review')}
                      onDismiss={() => onAction(s.id, 'dismiss')}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

