import React from 'react';
import { ReportRow } from '@/lib/reports';

interface ReportTableProps {
  rows: ReportRow[];
  onExportCsv: () => void;
  onExportPdf: () => void;
}

export default function ReportTable({ rows, onExportCsv, onExportPdf }: ReportTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg shadow ring-1 ring-gray-200">
      <table className="min-w-full divide-y divide-gray-200 bg-white">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Date</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Category</th>
            <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Amount</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Type</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-2 text-sm text-gray-700">{r.date}</td>
              <td className="px-4 py-2 text-sm text-gray-700">{r.category}</td>
              <td className="px-4 py-2 text-sm text-gray-700 text-right">${(r.amount / 100).toFixed(2)}</td>
              <td className="px-4 py-2 text-sm text-gray-700">{r.type}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end space-x-2 p-4 bg-gray-50 border-t border-gray-200">
        <button
          onClick={onExportCsv}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
        >
          Export CSV
        </button>
        <button
          onClick={onExportPdf}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
        >
          Export PDF
        </button>
      </div>
    </div>
  );
}
