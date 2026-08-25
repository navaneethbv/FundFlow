import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

/**
 * The report's row set, paginated through the URL so a page link is shareable
 * and needs no client JS. Amounts follow the app-wide Plaid convention
 * (positive = money out) and are rendered with an explicit direction word, so
 * the sign is never the only cue.
 */

export const REPORT_PAGE_SIZE = 50;

function flowLabel(row: CanonicalFinanceTransaction): string {
  if (row.flow === "transfer") return "Transfer";
  return row.flow === "income" ? "In" : "Out";
}

function flowAmountStyle(
  flow: CanonicalFinanceTransaction["flow"],
): { color: string } | undefined {
  if (flow === "income") {
    return { color: "var(--viz-pos)" };
  }
  if (flow === "expense") {
    return { color: "var(--viz-neg)" };
  }
  return undefined;
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
  const pageCount = Math.max(
    1,
    Math.ceil(transactions.length / REPORT_PAGE_SIZE),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * REPORT_PAGE_SIZE;
  const rows = transactions.slice(start, start + REPORT_PAGE_SIZE);

  if (transactions.length === 0) {
    return (
      <p className="py-4 text-sm text-muted">
        No transactions match these filters.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
      <table className="min-w-[42rem] w-full text-sm">
        <caption className="sr-only">
          Transactions matching the current report filters.
        </caption>
        <thead>
          <tr className="text-left opacity-60 font-mono">
            <th scope="col" className="py-2 pr-3 font-medium">Date</th>
            <th scope="col" className="py-2 pr-3 font-medium">Merchant</th>
            <th scope="col" className="py-2 pr-3 font-medium">Category</th>
            <th scope="col" className="py-2 pr-3 font-medium">Direction</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className={cn(
                "border-t border-black/5 dark:border-white/10",
                index % 2 === 1 && "bg-panel-2",
              )}
            >
              <td className="py-2 pr-3 whitespace-nowrap font-mono">{formatDate(row.date)}</td>
              <td className="py-2 pr-3">
                <span className="block max-w-[16rem] truncate">
                  {row.merchant || "Unknown"}
                </span>
                {row.pending && (
                  <span className="text-xs text-muted">Pending</span>
                )}
              </td>
              <td className="py-2 pr-3">
                <span className="block max-w-[14rem] truncate">
                  {row.categoryKey || "Unknown"}
                </span>
              </td>
              <td className="py-2 pr-3">{flowLabel(row)}</td>
              <td
                data-money
                className="py-2 pr-3 text-right"
                style={flowAmountStyle(row.flow)}
              >
                {formatCurrency(Math.abs(row.signedAmount), currency)}
              </td>
            </tr>
          ))}
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
