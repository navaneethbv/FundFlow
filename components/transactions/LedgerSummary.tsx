import Panel from "@/components/ui/Panel";
import ButtonLink from "@/components/ui/ButtonLink";
import { formatDate } from "@/lib/format-date";
import type { LedgerProjectedRow } from "@/lib/ledger-projection";

/** Page scope is explicit: a paginated ledger is not an all-time financial report. */
export default function LedgerSummary({ rows, total, page }: Readonly<{
  rows: LedgerProjectedRow[]; total: number; page: number;
}>) {
  const dates = rows.map(row => row.date).sort((a, b) => a.localeCompare(b));
  const currencies = [...new Set(rows.map(row => row.iso_currency_code ?? "Unknown"))].sort((a, b) => a.localeCompare(b));
  const lastDate = dates.at(-1);
  const entries = [
    ["Matching transactions", total.toLocaleString()],
    ["On this page", String(rows.length)],
    ["Pending on this page", String(rows.filter(row => row.pending).length)],
    ["First date on this page", dates[0] ? formatDate(dates[0]) : "—"],
    ["Last date on this page", lastDate ? formatDate(lastDate) : "—"],
    ["Currencies on this page", currencies.join(", ") || "—"],
  ];
  return <aside aria-label="Transaction summary" className="min-w-0 xl:sticky xl:top-20">
    <Panel title="Summary">
      <p className="mb-4 text-sm text-muted">Page {page} of the current search. Financial totals are available in Reports.</p>
      <dl className="space-y-4">{entries.map(([label, value]) => <div key={label} className="flex justify-between gap-4">
        <dt className="text-sm text-muted">{label}</dt><dd className="text-right text-base tabular-nums">{value}</dd>
      </div>)}</dl>
      <div className="mt-5 text-center"><ButtonLink href="/reports" variant="ghost" size="sm">View reports</ButtonLink></div>
    </Panel>
  </aside>;
}
