"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { downloadBlob } from "@/lib/browser-download";

/**
 * Client-side "Tax year CSV" action for Settings → Export data. A plain link
 * cannot carry a chosen year, so this downloads through `fetch` + a blob anchor
 * (same pattern as the PDF export) so a failure keeps the user on the page
 * with an in-app error.
 */
export default function TaxExportButton({
  className,
}: Readonly<{ className?: string }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  const years = Array.from({ length: 6 }, (_, index) => currentYear - index);

  async function download(year: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/export/tax?year=${encodeURIComponent(year)}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Could not generate the tax CSV. Try again.");
        return;
      }
      const blob = await response.blob();
      downloadBlob(blob, `fundflow-tax-${year}.csv`);
    } catch {
      setError("Could not generate the tax CSV. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted" htmlFor="tax-export-year">
          Tax year
        </label>
        <select
          id="tax-export-year"
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          className="min-h-11 rounded-field border border-panel-border bg-background px-3 text-sm text-foreground"
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onClick={() => {
            void download(selectedYear);
          }}
          className={className}
        >
          Export tax CSV
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
