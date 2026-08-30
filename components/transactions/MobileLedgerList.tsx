import { Fragment } from "react";
import Badge from "@/components/ui/Badge";
import TransactionEditor from "@/components/transactions/TransactionEditor";
import { MerchantAvatar } from "@/components/ui/Avatar";
import { formatCurrency, roundsToZero, titleCase } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { ledgerZebraBands, type LedgerDayGroup } from "@/lib/ledger-data";

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
  providerCategory?: string | null;
  override?: { displayCategory: string | null; cashFlowClassification: "expense" | "income" | null } | null;
}

/**
 * Money-in is the exception under the Plaid convention, so it is the only
 * direction that earns a colour. Painting every outflow red made the column a
 * uniform wall that carried no information; sign and alignment do that work.
 * A display zero is direction-neutral and earns no colour at all.
 */
function amountColor(amount: number): { color: string } | undefined {
  if (roundsToZero(amount)) return undefined;
  return amount < 0 ? { color: "var(--viz-pos)" } : undefined;
}

function signedAmount(amount: number, currency: string): string {
  if (roundsToZero(amount)) return formatCurrency(0, currency);
  return `${amount < 0 ? "+" : "-"}${formatCurrency(Math.abs(amount), currency)}`;
}

function DayHeader({
  group,
  currency,
}: Readonly<{ group: LedgerDayGroup; currency: string }>) {
  return (
    <li
      data-ledger-day-header={group.date}
      className="flex items-center justify-between gap-3 bg-panel/60 px-4 py-1.5 text-xs font-semibold text-muted"
    >
      <span className="font-mono">{formatDate(group.date)}</span>
      {group.showNet && (
        <span data-money className="font-normal" style={amountColor(group.net)}>
          {signedAmount(group.net, currency)} net
        </span>
      )}
    </li>
  );
}

/**
 * Phone-width twin of the ledger table: one stacked card per transaction.
 * Rendered below the `sm` breakpoint; the table remains the sm+ rendering.
 *
 * `dayGroups` carries the same metadata the desktop table uses, so the two
 * surfaces cannot disagree about a day's net. Pass `null` for the sorts where
 * day grouping does not apply (merchant, amount), which keeps the flat card
 * list and the per-card date.
 */
export default function MobileLedgerList({
  rows,
  dayGroups = null,
}: Readonly<{
  rows: LedgerCardRow[];
  dayGroups?: Map<string, LedgerDayGroup> | null;
}>) {
  const grouped = dayGroups !== null;
  // Banding restarts inside each day so the stripes line up with the groups
  // they are meant to organise.
  const bands = ledgerZebraBands(rows, grouped);

  return (
    <ul className="divide-y divide-panel-border">
      {rows.map((row, index) => {
        const prevRow = index > 0 ? rows[index - 1] : undefined;
        const startsDay = grouped && (prevRow === undefined || prevRow.date !== row.date);
        const band = bands[index] ?? 0;
        const striped = band % 2 === 1;
        const group = dayGroups?.get(row.date);

        return (
          <Fragment key={row.id}>
            {startsDay && group && <DayHeader group={group} currency={row.currency} />}
            <li className={`flex items-start gap-3 px-4 py-3${striped ? " bg-panel-2" : ""}`}>
              <MerchantAvatar name={row.merchant} size={32} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{row.merchant}</span>
                  {row.pending && <Badge tone="warning">pending</Badge>}
                  {row.excludedDuplicate && <Badge tone="warning">Excluded duplicate</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {!grouped && (
                    <>
                      <span className="font-mono">{formatDate(row.date)}</span>
                      {" · "}
                    </>
                  )}
                  {titleCase(row.category) || "Uncategorized"} · {row.accountLabel}
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
                  className="whitespace-nowrap font-semibold tabular-nums"
                  style={amountColor(row.amount)}
                >
                  {signedAmount(row.amount, row.currency)}
                </span>
                <TransactionEditor
                  idPrefix="mobile-"
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
                  providerCategory={row.providerCategory}
                  override={row.override}
                />
              </div>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
