'use client';

import React from 'react';
import type { CashFlowForecast } from '@/lib/planning';
import { formatCurrency } from '@/lib/format';

interface ForecastChartProps {
  forecast: CashFlowForecast;
}

export default function ForecastChart({ forecast }: ForecastChartProps) {
  const { projectedBalance, lowestBalance, lowBalanceRisk, assumptions, events } = forecast;

  // Simple bar-chart using CSS widths (no external charting lib)
  const maxBal = Math.max(...events.map((e) => Math.abs(e.projectedBalance)), 1);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 p-4 text-white shadow-lg">
          <p className="text-xs uppercase tracking-wider opacity-80">Projected Balance</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrency(projectedBalance)}</p>
        </div>
        <div className={`rounded-lg p-4 text-white shadow-lg ${lowBalanceRisk ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
          <p className="text-xs uppercase tracking-wider opacity-80">Lowest Balance</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrency(lowestBalance)}</p>
        </div>
        <div className="rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 p-4 text-white shadow-lg">
          <p className="text-xs uppercase tracking-wider opacity-80">Risk</p>
          <p className="mt-1 text-2xl font-bold">{lowBalanceRisk ? 'Yes ⚠️' : 'No ✅'}</p>
        </div>
      </div>

      {/* Assumptions */}
      <ul className="list-disc pl-5 text-sm text-gray-500">
        {assumptions.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>

      {/* Event timeline */}
      <div className="overflow-x-auto rounded-lg shadow ring-1 ring-gray-200">
        <table className="min-w-full divide-y divide-gray-200 bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Event</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Amount</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Balance</th>
              <th className="px-3 py-2 text-xs font-medium text-gray-600">Bar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.slice(0, 60).map((ev, i) => {
              const pct = Math.max(2, Math.round((Math.abs(ev.projectedBalance) / maxBal) * 100));
              const barColor = ev.projectedBalance >= 0 ? 'bg-emerald-400' : 'bg-red-400';
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-xs text-gray-700">{ev.date}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-700">{ev.name}</td>
                  <td className={`px-3 py-1.5 text-xs text-right font-mono ${ev.itemType === 'expense' ? 'text-red-600' : 'text-emerald-600'}`}>
                    {ev.itemType === 'expense' ? '-' : '+'}${Math.abs(ev.amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-right font-mono text-gray-800">
                    {formatCurrency(ev.projectedBalance)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
