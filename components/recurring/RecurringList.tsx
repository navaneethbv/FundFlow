"use client";

import { useState } from "react";
import { formatCurrency, titleCase } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";

export default function RecurringList({
  occurrences,
}: Readonly<{
  occurrences: RecurringOccurrence[];
}>) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleAction = async (streamId: string, action: "review" | "dismiss") => {
    setLoadingId(streamId);
    try {
      await fetch("/api/recurring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream_id: streamId, action }),
      });
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="rounded-panel border border-panel-border bg-panel overflow-hidden">
      <div className="border-b border-panel-border px-5 py-4">
        <h3 className="font-semibold text-foreground">Upcoming & Past Streams</h3>
      </div>

      <div className="divide-y divide-panel-border">
        {occurrences.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            No recurring streams found for this month.
          </div>
        ) : (
          occurrences.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-5 py-3.5 text-sm hover:bg-panel-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{item.merchant}</span>
                  {!item.reviewed && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[0.65rem] text-amber-500">
                      Unreviewed
                    </span>
                  )}
                  {item.status === "overdue" && (
                    <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[0.65rem] text-danger">
                      Overdue
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Due {item.dueDate} · {titleCase(item.frequency)}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className="font-semibold text-foreground">
                  {formatCurrency(item.amount)}
                </span>
                {!item.reviewed && item.source === "plaid" && (
                  <button
                    onClick={() => handleAction(item.sourceId, "review")}
                    disabled={loadingId === item.sourceId}
                    className="rounded bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent/90"
                  >
                    Confirm
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
