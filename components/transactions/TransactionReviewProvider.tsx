"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type {
  TransactionReviewStatus,
  TransactionReviewResult,
} from "@/lib/transaction-review";

export interface ReviewQueueRow {
  id: string;
  version: string;
  eligible: boolean;
  status: TransactionReviewStatus;
  date: string;
  merchant: string;
  accountLabel: string;
}

interface TransactionReviewContextValue {
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  selectShown: (ids: string[]) => void;
  clearSelection: () => void;
  isSubmitting: boolean;
  statusMessage: string | null;
  submitReview: (
    items: Array<{ id: string; version: string }>,
    status: TransactionReviewStatus,
  ) => Promise<boolean>;
  lastResult: TransactionReviewResult | null;
  resetResult: () => void;
  refreshReview: () => void;
  updateScope: (scope: ReviewScope) => void;
}

const TransactionReviewContext = createContext<TransactionReviewContextValue | null>(
  null,
);

interface ReviewScope {
  selectionScope: string;
  revision: string;
  authoritative: boolean;
  ownerId: string;
}

export function TransactionReviewProvider({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<ReviewScope>({ selectionScope: "", revision: "", authoritative: false, ownerId: "" });
  const { revision } = scope;
  const [awaitingRevision, setAwaitingRevision] = useState<string | null>(null);
  const focusAfterRefresh = useRef<string[] | null>(null);
  const requestInFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TransactionReviewResult | null>(null);

  const updateScope = useCallback((next: ReviewScope) => {
    // A layout effect publishes each server result before the browser can act
    // on its controls. IDs cannot retain selection across version changes.
    if (scope.selectionScope !== next.selectionScope) {
      setSelectedIds(new Set());
      if (selectedIds.size > 0) setStatusMessage("These transactions changed. Review the updated entries before trying again.");
    }
    if (scope.ownerId !== next.ownerId) {
      setLastResult(null);
      setStatusMessage(null);
    }
    if (next.authoritative && awaitingRevision !== null && awaitingRevision !== next.revision) setAwaitingRevision(null);
    setScope(next);
  }, [scope, selectedIds.size, awaitingRevision]);

  useEffect(() => {
    if (!focusAfterRefresh.current || isPending || awaitingRevision !== null) return;
    const candidates = focusAfterRefresh.current;
    focusAfterRefresh.current = null;
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-review-action]"))
      .filter((button) => !button.disabled && button.getClientRects().length > 0);
    const next = candidates.map((id) => buttons.find((button) => button.dataset.reviewAction === id)).find(Boolean) ?? buttons[0];
    (next ?? document.getElementById("transaction-review-heading"))?.focus();
  }, [revision, isPending, awaitingRevision]);

  const refreshReview = useCallback(() => {
    setAwaitingRevision(revision);
    startTransition(() => router.refresh());
  }, [revision, router]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectShown = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const submitReview = useCallback(
    async (
      items: Array<{ id: string; version: string }>,
      targetStatus: TransactionReviewStatus,
    ): Promise<boolean> => {
      if (items.length === 0 || requestInFlight.current || awaitingRevision !== null || isPending || !scope.authoritative) return false;
      requestInFlight.current = true;
      const visibleIds = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-review-action]"))
        .filter((button) => button.getClientRects().length > 0).map((button) => button.dataset.reviewAction!);
      const index = visibleIds.indexOf(items[0].id);
      const nextIds = [...visibleIds.slice(index + 1), ...visibleIds.slice(0, index)]
        .filter((id) => !items.some((item) => item.id === id));
      setLastResult(null);

      setIsSubmitting(true);
      setStatusMessage(
        targetStatus === "reviewed"
          ? "Marking transactions as reviewed..."
          : "Marking transactions as needs review...",
      );

      try {
        const res = await fetch("/api/transactions/review", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: targetStatus,
            items: items.map((it) => ({
              transaction_id: it.id,
              expected_version: it.version,
            })),
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) {
            setStatusMessage(
              body.error ||
                "These transactions changed. Review the updated entries before trying again.",
            );
            clearSelection();
            refreshReview();
            return false;
          }
          if (res.status === 404) {
            setStatusMessage("One or more selected transactions are unavailable.");
            clearSelection();
            refreshReview();
            return false;
          }
          setStatusMessage(body.error || "Failed to update review status.");
          return false;
        }

        const data: TransactionReviewResult = await res.json();
        setLastResult(data);
        clearSelection();

        const countText = `${data.updated} transaction${data.updated === 1 ? "" : "s"}`;
        setStatusMessage(
          targetStatus === "reviewed"
            ? `${countText} marked as reviewed.`
            : `${countText} marked as needs review.`,
        );

        focusAfterRefresh.current = nextIds;
        refreshReview();
        return true;
      } catch {
        setStatusMessage("Network error updating review status. Refreshing...");
        clearSelection();
        refreshReview();
        return false;
      } finally {
        requestInFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [clearSelection, refreshReview, awaitingRevision, isPending, scope.authoritative],
  );

  const resetResult = useCallback(() => {
    setLastResult(null);
  }, []);

  const value = useMemo(
    () => ({
      selectedIds,
      toggleSelect,
      selectShown,
      clearSelection,
      isSubmitting: isSubmitting || isPending || awaitingRevision !== null || !scope.authoritative,
      statusMessage,
      submitReview,
      lastResult,
      resetResult,
      refreshReview,
      updateScope,
    }),
    [
      selectedIds,
      toggleSelect,
      selectShown,
      clearSelection,
      isSubmitting,
      isPending,
      awaitingRevision,
      scope.authoritative,
      statusMessage,
      submitReview,
      lastResult,
      resetResult,
      refreshReview,
      updateScope,
    ],
  );

  return (
    <TransactionReviewContext.Provider value={value}>
      {children}
    </TransactionReviewContext.Provider>
  );
}

const DEFAULT_REVIEW_CONTEXT: TransactionReviewContextValue = {
  selectedIds: new Set(),
  isSubmitting: false,
  statusMessage: null,
  lastResult: null,
  toggleSelect: () => {},
  selectShown: () => {},
  clearSelection: () => {},
  submitReview: async () => false,
  resetResult: () => {},
  refreshReview: () => {},
  updateScope: () => {},
};

export function useTransactionReview(): TransactionReviewContextValue {
  const ctx = useContext(TransactionReviewContext);
  return ctx ?? DEFAULT_REVIEW_CONTEXT;
}

/** Bridges each server-rendered page into the persistent layout context. */
export function TransactionReviewScope(props: Readonly<ReviewScope>) {
  const { updateScope } = useTransactionReview();
  const update = useRef(updateScope);
  useLayoutEffect(() => { update.current = updateScope; });
  const { selectionScope, revision, authoritative, ownerId } = props;
  useLayoutEffect(() => {
    update.current({ selectionScope, revision, authoritative, ownerId });
  }, [selectionScope, revision, authoritative, ownerId]);
  return null;
}
