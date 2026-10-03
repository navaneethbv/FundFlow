"use client";
import { useEffect, useState } from "react";
export default function RuleChangeProvenance({
  transactionId,
}: Readonly<{ transactionId: string }>) {
  const [message, setMessage] = useState("Loading rule provenance...");
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/rules/history?transactionId=${encodeURIComponent(transactionId)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Rule provenance is unavailable.");
        const data = await response.json();
        setMessage(
          data.changes.length
            ? data.changes
                .map(
                  (change: {
                    rule_runs: { rule_id: string | null };
                    created_at: string;
                  }) =>
                    `Changed by rule ${change.rule_runs?.rule_id?.slice(0, 8) ?? "deleted"} on ${change.created_at.slice(0, 10)}`,
                )
                .join(". ")
            : "No recorded rule changes.",
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [transactionId]);
  return (
    <output aria-live="polite" className="my-3 block text-xs text-muted">
      {message}
    </output>
  );
}
