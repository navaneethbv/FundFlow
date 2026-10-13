import { formatDate } from "@/lib/format-date";
import { titleCase } from "@/lib/format";
import type { ReportFilters } from "@/lib/reports";
import { REPORT_PAGE_SIZE } from "@/components/reports/ReportTransactions";

export default function ReportPrintContext({ filters, currency, page, total, accountNames }: Readonly<{
  filters: ReportFilters;
  currency: string;
  page: number;
  total: number;
  accountNames?: ReadonlyMap<string, string>;
}>) {
  const safePage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE)));
  const first = (safePage - 1) * REPORT_PAGE_SIZE + 1;
  const last = Math.min(first + REPORT_PAGE_SIZE - 1, total);
  const selections = [
    ...filters.accounts.map(id => accountNames?.get(id) ?? "Selected account"),
    ...filters.merchants,
    ...filters.categories.map(titleCase),
  ];
  return (
    <section aria-label="Report context" className="rounded-field border border-panel-border p-3 text-sm text-muted">
      <p className="font-semibold text-foreground">{formatDate(filters.start)} – {formatDate(filters.end)} · {currency}</p>
      <p>{filters.scope ? "Household" : "Personal"} · {filters.excludePending ? "Pending excluded" : "Pending included"}</p>
      {selections.length > 0 && <p className="break-words">Filters: {selections.join(" · ")}</p>}
      <p>{total > 0 ? `Transactions ${first}–${last} of ${total}` : "No matching transactions"}. Summary covers all matching transactions; printing includes the displayed transaction page.</p>
    </section>
  );
}
