import Badge from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

export interface ProjectedLedgerItem {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  kind: "debit" | "credit";
}

export default function ProjectedLedgerSection({ items }: Readonly<{ items: ProjectedLedgerItem[] }>) {
  if (items.length === 0) return null;
  return (
    <Panel title="Upcoming projected transactions" eyebrow="Excluded from posted totals">
      <div className="divide-y divide-panel-border">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0"><p className="truncate font-medium">{item.merchant}</p><p className="text-xs text-muted">{formatDate(item.date)}</p></div>
            <div className="flex items-center gap-2"><Badge tone="accent">Projected</Badge><span data-money className="font-semibold">{item.kind === "debit" ? "-" : "+"}{formatCurrency(item.amount)}</span></div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
