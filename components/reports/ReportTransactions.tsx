import { Fragment } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCurrency, titleCase } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import {
  buildLedgerDayGroups,
  ledgerZebraBands,
  type LedgerDayGroup,
} from "@/lib/ledger-data";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

/**
 * The report's row set, paginated through the URL so a page link is shareable
 * and needs no client JS. Amounts follow the app-wide Plaid convention
 * (positive = money out), rendered as a signed figure with the direction kept
 * available to assistive technology, so the sign is never the only cue.
 *
 * Rows carry the same day-group hierarchy as the transactions register. Group
 * nets are computed against the full filtered set rather than the visible
 * page, so a day split across a page boundary reports no total instead of a
 * partial one.
 */

export const REPORT_PAGE_SIZE = 50;

const COLUMN_COUNT = 4;

function directionLabel(row: CanonicalFinanceTransaction): string {
  if (row.flow === "transfer") return "Transfer";
  return row.flow === "income" ? "In" : "Out";
}

/**
 * Money-in is the exception here, so it is the only direction that earns a
 * colour. Transfers stay neutral, and ordinary expenses use the default
 * foreground rather than a red that repeats on nearly every row.
 */
function amountColor(
  flow: CanonicalFinanceTransaction["flow"],
): { color: string } | undefined {
  return flow === "income" ? { color: "var(--viz-pos)" } : undefined;
}

function signedAmount(signed: number, currency: string): string {
  if (signed === 0) return formatCurrency(0, currency);
  return `${signed < 0 ? "+" : "-"}${formatCurrency(Math.abs(signed), currency)}`;
}

function DayHeaderRow({
  group,
  currency,
}: Readonly<{ group: LedgerDayGroup; currency: string }>) {
  return (
    <tr
      data-ledger-day-header={group.date}
      className="border-t border-black/5 bg-panel/60 dark:border-white/10"
    >
      <th
        scope="row"
        colSpan={COLUMN_COUNT - 1}
        className="py-1.5 pr-3 text-left font-mono text-xs font-semibold text-muted"
      >
        {formatDate(group.date)}
      </th>
      {/* The net sits in the amount column so it shares a decimal edge with
          the rows it totals. */}
      <td className="py-1.5 pr-3 text-right text-xs font-normal text-muted">
        {group.showNet && (
          <span data-money style={amountColor(group.net < 0 ? "income" : "expense")}>
            {signedAmount(group.net, currency)} net
          </span>
        )}
      </td>
    </tr>
  );
}

export default function ReportTransactions({
  transactions,
  currency,
  page,
  hrefForPage,
}: Readonly<{
  transactions: CanonicalFinanceTransaction[];
  currency: string;
  page: number;
  hrefForPage: (page: number) => string;
}>) {
  const pageCount = Math.max(1, Math.ceil(transactions.length / REPORT_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * REPORT_PAGE_SIZE;
  const rows = transactions.slice(start, start + REPORT_PAGE_SIZE);

  if (transactions.length === 0) {
    return <p className="py-4 text-sm text-muted">No transactions match these filters.</p>;
  }

  const toGroupable = (row: CanonicalFinanceTransaction) => ({
    id: row.id,
    date: row.date,
    amount: row.signedAmount,
  });
  const dayGroups = buildLedgerDayGroups(rows.map(toGroupable), {
    allRows: transactions.map(toGroupable),
  });

  const bands = ledgerZebraBands(rows, true);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-[42rem] w-full text-sm">
          <caption className="sr-only">
            Transactions matching the current report filters, grouped by day.
          </caption>
          <thead>
            <tr className="text-left font-mono opacity-60">
              <th scope="col" className="py-2 pr-3 font-medium">Date</th>
              <th scope="col" className="py-2 pr-3 font-medium">Merchant</th>
              <th scope="col" className="py-2 pr-3 font-medium">Category</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row, index) => {
              const startsDay = index === 0 || rows[index - 1]!.date !== row.date;
              const striped = bands[index]! % 2 === 1;
              const group = dayGroups.get(row.date);

              return (
                <Fragment key={row.id}>
                  {startsDay && group && <DayHeaderRow group={group} currency={currency} />}
                  <tr
                    className={cn(
                      "border-t border-black/5 dark:border-white/10",
                      striped && "bg-panel-2",
                    )}
                  >
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-muted">
                      {formatDate(row.date)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block max-w-[16rem] truncate">
                        {row.merchant || "Unknown"}
                      </span>
                      {row.pending && <span className="text-xs text-muted">Pending</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block max-w-[14rem] truncate">
                        {titleCase(row.categoryKey) || "Unknown"}
                      </span>
                    </td>
                    {/*
                      `relative` is load-bearing: `sr-only` is absolutely
                      positioned, so without a positioned ancestor it resolves
                      against the initial containing block. Inside this table
                      that static position sits past the viewport edge and
                      stretches the document's scroll width, which showed up as
                      the whole page scrolling sideways on a phone.
                    */}
                    <td
                      data-money
                      className="relative py-2 pr-3 text-right"
                      style={amountColor(row.flow)}
                    >
                      {signedAmount(row.signedAmount, currency)}
                      <span className="sr-only"> {directionLabel(row)}</span>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <nav
          aria-label="Report transaction pages"
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          <p className="text-xs text-muted">
            Page {safePage} of {pageCount} · {transactions.length} transactions
          </p>
          <div className="ml-auto flex gap-1">
            {safePage > 1 && (
              <Link
                href={hrefForPage(safePage - 1)}
                className="inline-flex min-h-11 items-center rounded-field px-3 py-2 text-sm font-semibold text-muted hover:bg-panel-hover focus-visible:outline-2"
              >
                Previous
              </Link>
            )}
            {safePage < pageCount && (
              <Link
                href={hrefForPage(safePage + 1)}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-field px-3 py-2 text-sm font-semibold",
                  "text-muted hover:bg-panel-hover focus-visible:outline-2",
                )}
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
