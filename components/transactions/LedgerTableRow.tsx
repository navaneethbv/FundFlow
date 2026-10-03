import { Fragment } from "react";
import Badge from "@/components/ui/Badge";
import { MerchantAvatar } from "@/components/ui/Avatar";
import CategoryChip from "@/components/ui/CategoryChip";
import TransactionEditor from "@/components/transactions/TransactionEditor";
import { TransactionReviewCheckbox, TransactionReviewRowAction } from "@/components/transactions/TransactionReviewControls";
import { TransactionReviewStatusBadge } from "@/components/transactions/TransactionReviewStatus";
import { merchantLogoDataUri } from "@/lib/merchant-logos";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency, roundsToZero, titleCase } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { LedgerProjectedRow } from "@/lib/ledger-projection";
import type { LedgerDayGroup } from "@/lib/ledger-data";

function ledgerNetPrefix(net: number): string {
  if (roundsToZero(net)) return "";
  if (net < 0) return "+";
  if (net > 0) return "-";
  return "";
}

interface LedgerTableRowProps {
  row: LedgerProjectedRow;
  /** Position within its date group when day grouping is active. */
  zebraBand: number;
  /** Render the day-group header above this row. */
  isNewDay: boolean;
  grouped: boolean;
  dayGroup: LedgerDayGroup | undefined;
  visibleColumns: ReadonlySet<string>;
  excludedDuplicate: boolean;
  note: string | null;
  tags: string[];
  cleared: boolean;
  splits: Array<{ category: string; amount: number }>;
  categoryOptions: string[];
  providerCategory?: string | null;
  override?: { displayCategory: string | null; cashFlowClassification: "expense" | "income" | null } | null;
  reviewEnabled?: boolean;
  reviewStatus?: "needs_review" | "reviewed" | null;
  reviewVersion?: string | null;
  reviewEligible?: boolean;
  reviewStateMissing?: boolean;
  bulkEditEnabled?: boolean;
  keyboardEnabled?: boolean;
  undoEnabled?: boolean;
}

/** Columns a day-group header spans; must match the header row's cells. */
function ledgerColumnCount(reviewEnabled: boolean, bulkEditEnabled: boolean, visibleColumns: ReadonlySet<string>): number {
  let count = reviewEnabled ? 5 : 4;
  if (bulkEditEnabled) count += 1;
  if (visibleColumns.has("category")) count += 1;
  if (visibleColumns.has("account")) count += 1;
  return count;
}

function BulkSelectCell({ id, merchant, reviewVersion }: Readonly<{ id: string; merchant: string; reviewVersion: string | null }>) {
  return (
    <td className="w-10 px-3 py-3 align-top text-center">
      <input
        type="checkbox"
        data-bulk-select
        data-transaction-id={id}
        aria-label={`Select ${merchant}`}
        className="h-4 w-4 accent-[var(--accent)]"
      />
      <input type="hidden" data-review-version={id} value={reviewVersion ?? "1"} />
    </td>
  );
}

/**
 * One desktop ledger row, plus the day-group header that precedes the first
 * row of each date. Split out of the page so the page body stays readable:
 * the optional column/badge/annotation branches all live here.
 */
export default function LedgerTableRow({
  row,
  zebraBand,
  isNewDay,
  grouped,
  dayGroup,
  visibleColumns,
  excludedDuplicate,
  note,
  tags,
  cleared,
  splits,
  categoryOptions,
  providerCategory = null,
  override = null,
  reviewEnabled = false,
  reviewStatus = null,
  reviewVersion = null,
  reviewEligible = false,
  reviewStateMissing = false,
  bulkEditEnabled = false,
  keyboardEnabled = false,
  undoEnabled = false,
}: Readonly<LedgerTableRowProps>) {
  const columnCount = ledgerColumnCount(reviewEnabled, bulkEditEnabled, visibleColumns);
  const hasAnnotations = Boolean(note) || tags.length > 0 || splits.length > 0 || cleared;
  const merchant = row.merchant || "Unknown";
  const currency = row.iso_currency_code ?? "USD";
  const isMoneyIn = row.amount < 0 && !roundsToZero(row.amount);
  const showsAmount = !roundsToZero(row.amount);
  const amountSign = isMoneyIn ? "+" : "-";
  const amountDisplay = showsAmount
    ? `${amountSign}${formatCurrency(Math.abs(row.amount), currency)}`
    : formatCurrency(0, currency);

  return (
    <Fragment>
      {isNewDay && (
        <tr className="border-b border-panel-border bg-panel/60">
          <th
            scope="row"
            colSpan={columnCount - 2}
            className="px-4 py-1.5 text-left tabular-nums text-xs font-semibold text-muted"
          >
            {formatDate(row.date)}
          </th>
          <td className="px-4 py-1.5 text-right text-xs font-normal text-muted">
            {dayGroup?.showNet && (
              <span
                data-money
                style={dayGroup.net < 0 ? { color: "var(--viz-pos)" } : undefined}
              >
                {roundsToZero(dayGroup.net)
                  ? formatCurrency(0)
                  : `${ledgerNetPrefix(dayGroup.net)}${formatCurrency(Math.abs(dayGroup.net))}`}{" "}
                net
              </span>
            )}
          </td>
          <td />
        </tr>
      )}
      <tr
        data-ledger-row
        data-ledger-row-id={row.id}
        tabIndex={keyboardEnabled ? 0 : undefined}
        aria-label={`Transaction ${merchant}`}
        className={`border-b border-panel-border last:border-0 hover:bg-panel-hover${
          zebraBand % 2 === 1 ? " bg-panel-2" : ""
        }`}
      >
        {bulkEditEnabled && <BulkSelectCell id={row.id} merchant={merchant} reviewVersion={reviewVersion} />}
        {reviewEnabled && (
          <td className="w-10 px-3 py-3 align-top text-center">
            <TransactionReviewCheckbox
              id={row.id}
              eligible={reviewEligible}
              date={row.date}
              merchant={merchant}
              accountLabel={row.accountLabel}
              prefix="desktop"
            />
          </td>
        )}
        <td className="whitespace-nowrap px-4 py-3 align-top text-muted tabular-nums">
          {/* The day header row already shows this date; keep it for screen readers. */}
          <span className={grouped ? "sr-only" : undefined}>
            {formatDate(row.date)}
          </span>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex items-start gap-2.5">
            <MerchantAvatar
              name={row.merchant || "?"}
              logoUrl={merchantLogoDataUri(row.merchant || "?")}
              size={28}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="font-medium">{merchant}</span>
              {row.pending && (
                <Badge tone="warning" className="ml-2">
                  pending
                </Badge>
              )}
              {cleared && (
                <Badge tone="success" className="ml-2">
                  cleared
                </Badge>
              )}
              {excludedDuplicate && (
                <Badge tone="warning" className="ml-2">
                  Excluded duplicate
                </Badge>
              )}
              {reviewEnabled && (reviewStatus || reviewStateMissing) && (
                <span className="ml-2">
                  <TransactionReviewStatusBadge
                    status={reviewStatus}
                    pending={row.pending}
                    excludedDuplicate={excludedDuplicate}
                    missing={reviewStateMissing}
                  />
                </span>
              )}
              {visibleColumns.has("source") && row.source === "manual" && (
                <Badge tone="accent" className="ml-2">
                  manual
                </Badge>
              )}
              {hasAnnotations && (
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  {splits.length > 0 && <Badge tone="accent">split ×{splits.length}</Badge>}
                  {tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                  {note && <span className="text-xs text-muted">{note}</span>}
                </span>
              )}
            </span>
          </div>
        </td>
        {visibleColumns.has("category") && (
          <td className="hidden px-4 py-3 align-top text-muted sm:table-cell">
            {row.category ? <CategoryChip label={titleCase(row.category)} /> : "-"}
          </td>
        )}
        {visibleColumns.has("account") && (
          <td className="hidden px-4 py-3 align-top text-muted md:table-cell">
            {row.accountLabel || "-"}
          </td>
        )}
        <td
          data-money
          className="whitespace-nowrap px-4 py-3 text-right align-top font-semibold"
          style={isMoneyIn ? { color: "var(--viz-pos)" } : undefined}
        >
          {amountDisplay}
        </td>
        <td className="px-2 py-3 text-right align-top">
          <div className="flex items-center justify-end gap-1.5">
            {reviewEnabled && reviewEligible && (
              <TransactionReviewRowAction
                id={row.id}
                version={reviewVersion}
                status={reviewStatus}
                eligible={reviewEligible}
                prefix="desktop"
              />
            )}
            <TransactionEditor
              detailsEnabled={isFeatureEnabled("transactionDetails")}
              suggestionsEnabled={isFeatureEnabled("ruleSuggestions") && isFeatureEnabled("compoundRules")}
              ruleHistoryEnabled={isFeatureEnabled("ruleRunHistory")}
              transaction={{ id: row.id, merchant, amount: row.amount, currency }}
              note={note}
              tags={tags}
              splits={splits}
              categories={categoryOptions}
              providerCategory={providerCategory}
              override={override}
              cleared={cleared}
              undoEnabled={undoEnabled}
            />
          </div>
        </td>
      </tr>
    </Fragment>
  );
}

