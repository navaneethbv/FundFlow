"use client";

import {
  createContext,
  useCallback,
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
}

const TransactionReviewContext = createContext<TransactionReviewContextValue | null>(
  null,
);

export function TransactionReviewProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TransactionReviewResult | null>(null);

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
      if (items.length === 0) return false;

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
            startTransition(() => {
              router.refresh();
            });
            return false;
          }
          if (res.status === 404) {
            setStatusMessage("One or more selected transactions are unavailable.");
            clearSelection();
            startTransition(() => {
              router.refresh();
            });
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

        startTransition(() => {
          router.refresh();
        });
        return true;
      } catch {
        setStatusMessage("Network error updating review status. Refreshing...");
        startTransition(() => {
          router.refresh();
        });
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [router, clearSelection],
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
      isSubmitting: isSubmitting || isPending,
      statusMessage,
      submitReview,
      lastResult,
      resetResult,
    }),
    [
      selectedIds,
      toggleSelect,
      selectShown,
      clearSelection,
      isSubmitting,
      isPending,
      statusMessage,
      submitReview,
      lastResult,
      resetResult,
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
};

export function useTransactionReview(): TransactionReviewContextValue {
  const ctx = useContext(TransactionReviewContext);
  return ctx ?? DEFAULT_REVIEW_CONTEXT;
}
