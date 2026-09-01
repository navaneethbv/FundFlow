"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { localDateKey } from "@/lib/format-date";

/**
 * Client-side "Export PDF" action for the spending-insights report.
 *
 * Downloads through `fetch` + a blob anchor rather than a plain link so a
 * server failure (403 export disabled, 400, 500) keeps the user on the page
 * with an in-app error instead of navigating the browser to a raw JSON error
 * document. Used on the Review page (a selected `month`), and on Reports and
 * Settings with no `month` for the current week's report.
 */
export default function ExportReportButton({
  month,
  label = "Export PDF",
  className,
}: Readonly<{ month?: string; label?: string; className?: string }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function filenameFrom(response: Response): string {
    const fromHeader = /filename="([^"]+)"/.exec(
      response.headers.get("content-disposition") ?? "",
    )?.[1];
    if (fromHeader) return fromHeader;
    return `fundflow-report-${month ?? localDateKey()}.pdf`;
  }

  async function download(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const url = month
        ? `/api/export/report?month=${encodeURIComponent(month)}`
        : "/api/export/report";
      const response = await fetch(url);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Could not generate the PDF report. Try again.");
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filenameFrom(response);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Could not generate the PDF report. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        loading={busy}
        disabled={busy}
        onClick={() => void download()}
        className={className}
      >
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
