"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

/**
 * Bulk tagging (8.5): applies one tag to every transaction currently
 * visible on the page — filter first, then tag the result set. "tax" and
 * "receipt" get one-click chips since they drive other features.
 */
export default function BulkTagBar({ transactionIds }: { transactionIds: string[] }) {
  const router = useRouter();
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (transactionIds.length === 0) return null;

  async function apply(value: string) {
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/transactions/annotate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_ids: transactionIds, tag: cleaned }),
      });
      const data = (await response.json().catch(() => null)) as {
        updated?: number;
        error?: string;
      } | null;
      if (!response.ok) {
        setStatus(data?.error ?? "Could not tag these transactions.");
        return;
      }
      setStatus(`Tagged ${data?.updated ?? 0} transaction(s) with "${cleaned}".`);
      setTag("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-muted">
        Tag all {transactionIds.length} shown:
      </span>
      {["tax", "receipt"].map((preset) => (
        <Button
          key={preset}
          onClick={() => apply(preset)}
          variant="ghost"
          size="sm"
          disabled={busy}
        >
          {preset}
        </Button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void apply(tag);
        }}
        className="inline-flex items-center gap-1"
      >
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="custom tag"
          maxLength={40}
          className="w-28 rounded-field border border-panel-border bg-panel px-2 py-1"
          disabled={busy}
        />
        <Button type="submit" variant="ghost" size="sm" disabled={busy}>
          Apply
        </Button>
      </form>
      {status && <span className="text-muted">{status}</span>}
    </div>
  );
}
