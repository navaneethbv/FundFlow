import React, { useEffect, useState } from 'react';
import ReportTabs from '@/components/reports/ReportTabs';
import ReportTable from '@/components/reports/ReportTable';
import { ReportRow } from '@/lib/reports';

export default function ReportsPage() {
  const [selected, setSelected] = useState<string>('cash');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch sample data (replace with real query later)
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const res = await fetch('/api/reports/data');
      const json = await res.json();
      setRows(json.rows ?? []);
      setLoading(false);
    }
    fetchData();
  }, []);

  const exportCsv = async () => {
    // Simple client‑side CSV generation for demo purposes
    const header = 'date,category,amount,type';
    const rowsCsv = rows
      .map((r) => `${r.date},${r.category},${r.amount},${r.type}`)
      .join('\n');
    const blob = new Blob([header + '\n' + rowsCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const res = await fetch('/api/reports/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
    const { dataUrl } = await res.json();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'report.pdf';
    a.click();
  };

  return (
    <section className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Financial Reports</h1>
      <ReportTabs selected={selected} onSelect={setSelected} />
      {loading ? (
        <p className="text-gray-600">Loading…</p>
      ) : (
        <ReportTable rows={rows} onExportCsv={exportCsv} onExportPdf={exportPdf} />
      )}
    </section>
  );
}
