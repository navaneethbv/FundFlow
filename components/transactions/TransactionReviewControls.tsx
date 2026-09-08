"use client";

import { useId } from "react";
import Button from "@/components/ui/Button";
import { Check, RotateCcw } from "@/components/ui/icons";
import { useTransactionReview } from "./TransactionReviewProvider";
import type { TransactionReviewStatus } from "@/lib/transaction-review";

export function TransactionReviewRowAction({
  id,
  version,
  status,
  eligible,
  prefix = "desktop",
}: Readonly<{
  id: string;
  version?: string | null;
  status?: TransactionReviewStatus | null;
  eligible?: boolean;
  prefix?: string;
}>) {
  const { submitReview, isSubmitting } = useTransactionReview();
  const reactId = useId();
  const buttonId = `${prefix}-review-btn-${id || reactId}`;

  if (!eligible || !version) {
    return null;
  }

  const isReviewed = status === "reviewed";

  const handleClick = () => {
    const targetStatus: TransactionReviewStatus = isReviewed
      ? "needs_review"
      : "reviewed";
    void submitReview([{ id, version }], targetStatus);
  };

  return (
    <Button
      id={buttonId}
      variant="secondary"
      size="sm"
      disabled={isSubmitting}
      onClick={handleClick}
      aria-label={
        isReviewed
          ? "Mark transaction as needs review"
          : "Mark transaction as reviewed"
      }
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs"
    >
      {isReviewed ? (
        <>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Review again
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5" aria-hidden />
          Mark reviewed
        </>
      )}
    </Button>
  );
}

export function TransactionReviewCheckbox({
  id,
  eligible,
  date,
  merchant,
  accountLabel,
  prefix = "desktop",
}: Readonly<{
  id: string;
  eligible?: boolean;
  date: string;
  merchant: string;
  accountLabel: string;
  prefix?: string;
}>) {
  const { selectedIds, toggleSelect, isSubmitting } = useTransactionReview();
  const isSelected = selectedIds.has(id);
  const inputId = `${prefix}-select-txn-${id}`;

  if (!eligible) {
    return <span className="inline-block w-4" aria-hidden />;
  }

  return (
    <input
      id={inputId}
      type="checkbox"
      disabled={isSubmitting}
      checked={isSelected}
      onChange={() => toggleSelect(id)}
      aria-label={`Select transaction ${merchant} on ${date} from ${accountLabel}`}
      className="h-4 w-4 rounded border-panel-border text-accent focus:ring-accent"
    />
  );
}

export function TransactionReviewBulkStrip({
  eligibleRows,
}: Readonly<{
  eligibleRows: Array<{ id: string; version: string }>;
}>) {
  const {
    selectedIds,
    selectShown,
    clearSelection,
    submitReview,
    isSubmitting,
    statusMessage,
  } = useTransactionReview();

  const selectedEligible = eligibleRows.filter((row) =>
    selectedIds.has(row.id),
  );
  const selectedCount = selectedEligible.length;
  const allEligibleIds = eligibleRows.map((r) => r.id);
  const isAllSelected =
    allEligibleIds.length > 0 &&
    allEligibleIds.every((id) => selectedIds.has(id));
  const isIndeterminate =
    selectedCount > 0 && selectedCount < allEligibleIds.length;

  if (allEligibleIds.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 bg-panel-2 px-4 py-2 border-b border-panel-border text-sm"
      aria-label="Bulk transaction review actions"
    >
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
          <input
            type="checkbox"
            id="review-select-all-shown"
            aria-label="Select all eligible transactions on this page"
            checked={isAllSelected}
            ref={(el) => {
              if (el) el.indeterminate = isIndeterminate;
            }}
            disabled={isSubmitting}
            onChange={() => selectShown(allEligibleIds)}
            className="h-4 w-4 rounded border-panel-border text-accent focus:ring-accent"
          />
          <span>Select shown ({allEligibleIds.length})</span>
        </label>
        {selectedCount > 0 && (
          <span className="text-xs text-muted">
            {selectedCount} selected
          </span>
        )}
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2">
          <Button
            id="bulk-mark-reviewed-btn"
            size="sm"
            disabled={isSubmitting}
            onClick={() => void submitReview(selectedEligible, "reviewed")}
          >
            Mark {selectedCount} selected as reviewed
          </Button>
          <Button
            id="bulk-mark-needs-review-btn"
            variant="secondary"
            size="sm"
            disabled={isSubmitting}
            onClick={() => void submitReview(selectedEligible, "needs_review")}
          >
            Mark as needs review
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={isSubmitting}
            onClick={clearSelection}
          >
            Cancel
          </Button>
        </div>
      )}

      {statusMessage && (
        <output
          className="text-xs text-muted w-full mt-1"
          aria-live="polite"
        >
          {statusMessage}
        </output>
      )}
    </div>
  );
}
