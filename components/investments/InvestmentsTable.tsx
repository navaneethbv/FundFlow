import React from 'react';
import { Holding } from '@/lib/investments';
import { formatCurrency } from '@/lib/format';

interface InvestmentsTableProps {
  holdings: Holding[];
}

export default function InvestmentsTable({ holdings }: InvestmentsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg shadow ring-1 ring-gray-200">
      <table className="min-w-full divide-y divide-gray-200 bg-white">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Name</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Ticker</th>
            <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Shares</th>
            <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Price</th>
            <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {holdings.map((h) => (
            <tr key={h.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 text-sm text-gray-700">{h.name}</td>
              <td className="px-4 py-2 text-sm text-gray-700">{h.ticker}</td>
              <td className="px-4 py-2 text-sm text-gray-700 text-right">{h.quantity}</td>
              <td className="px-4 py-2 text-sm text-gray-700 text-right">${(h.price / 100).toFixed(2)}</td>
              <td className="px-4 py-2 text-sm text-gray-700 text-right">${(h.value / 100).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
