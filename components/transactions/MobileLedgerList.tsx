import Badge from "@/components/ui/Badge";
import TransactionEditor from "@/components/transactions/TransactionEditor";
import { MerchantAvatar } from "@/components/ui/Avatar";
import { formatCurrency, titleCase } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

export interface LedgerCardRow {
  id: string;
  date: string;
  merchant: string;
  category: string | null;
  accountLabel: string;
  amount: number;
  currency: string;
  pending: boolean;
  excludedDuplicate?: boolean;
  note: string | null;
  tags: string[];
  splits: { category: string; amount: number }[];
  categoryOptions: string[];
}

/**
 * Phone-width twin of the ledger table: one stacked card per transaction.
 * Rendered below the `sm` breakpoint; the table remains the sm+ rendering.
 */
export default function MobileLedgerList({ rows }: Readonly<{ rows: LedgerCardRow[] }>) {
  return (
    <ul className="divide-y divide-panel-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start gap-3 px-4 py-3">
          <MerchantAvatar name={row.merchant} size={32} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.merchant}</span>
              {row.pending && <Badge tone="warning">pending</Badge>}
              {row.excludedDuplicate && <Badge tone="warning">Excluded duplicate</Badge>}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {formatDate(row.date)} · {titleCase(row.category) || "Uncategorized"} ·{" "}
              {row.accountLabel}
            </p>
            {(row.note || row.tags.length > 0 || row.splits.length > 0) && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5">
                {row.splits.length > 0 && (
                  <Badge tone="accent">split ×{row.splits.length}</Badge>
                )}
                {row.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
                {row.note && <span className="text-xs text-muted">{row.note}</span>}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              data-money
              className={
                row.amount < 0
                  ? "whitespace-nowrap font-semibold tabular-nums text-success"
                  : "whitespace-nowrap font-semibold tabular-nums text-foreground"
              }
            >
              {row.amount < 0 ? "+" : "-"}
              {formatCurrency(Math.abs(row.amount), row.currency)}
            </span>
            <TransactionEditor
              transaction={{
                id: row.id,
                merchant: row.merchant,
                amount: row.amount,
                currency: row.currency,
              }}
              note={row.note}
              tags={row.tags}
              splits={row.splits}
              categories={row.categoryOptions}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
