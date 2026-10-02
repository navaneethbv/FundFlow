import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

export interface PriceChangeHistoryRow {
  id: string;
  recurring_stream_id: string;
  effective_date: string;
  previous_amount: number | string;
  new_amount: number | string;
}

export default function PriceChangeHistory({
  rows,
  streamNames,
  currency,
}: Readonly<{ rows: PriceChangeHistoryRow[]; streamNames: ReadonlyMap<string, string>; currency: string }>) {
  if (rows.length === 0) return null;
  return (
    <Panel title="Confirmed price changes" eyebrow="Recurring history">
      <ul className="divide-y divide-panel-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
            <span>{streamNames.get(row.recurring_stream_id) ?? "Recurring charge"}<span className="block text-xs text-muted">Effective {formatDate(row.effective_date)}</span></span>
            <span data-money className="font-semibold">{formatCurrency(Number(row.previous_amount), currency)} → {formatCurrency(Number(row.new_amount), currency)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
