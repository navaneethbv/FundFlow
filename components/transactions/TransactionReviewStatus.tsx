"use client";

import Badge from "@/components/ui/Badge";
import type { TransactionReviewStatus } from "@/lib/transaction-review";

export function TransactionReviewStatusBadge({
  status,
  pending,
  excludedDuplicate,
  missing,
}: Readonly<{
  status?: TransactionReviewStatus | null;
  pending?: boolean;
  excludedDuplicate?: boolean;
  missing?: boolean;
}>) {
  if (missing) {
    return <Badge tone="neutral">Review unavailable</Badge>;
  }

  if (pending) {
    return <Badge tone="neutral">Pending</Badge>;
  }

  if (excludedDuplicate) {
    return <Badge tone="neutral">Excluded duplicate</Badge>;
  }

  if (status === "reviewed") {
    return <Badge tone="success">Reviewed</Badge>;
  }

  return <Badge tone="warning">Needs review</Badge>;
}
