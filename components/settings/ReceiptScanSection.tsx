"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface ScanResult {
  merchant: string;
  amount: number;
  date: string;
  lineItems: string[];
  matchedTransactionId: string | null;
}

/**
 * Receipt scanning (Bucket 2): the photo goes to the AI provider (that's
 * why it sits behind the AI consent), gets extracted, and — when a ledger
 * match is found — you choose whether to attach the line items as a note
 * via the existing annotate endpoint. The image itself is never stored.
 */
export default function ReceiptScanSection({ enabled }: { enabled: boolean }) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function scan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(null);
    setResult(null);
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/ai/receipt", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as
        | (ScanResult & { error?: string })
        | null;
      if (!response.ok || !data || data.error) {
        setStatus(data?.error ?? "Could not read the receipt.");
        return;
      }
      setResult(data);
    } finally {
      setBusy(false);
    }
  }

  async function attach() {
    if (!result?.matchedTransactionId) return;
    setStatus(null);
    const note = `Receipt: ${result.merchant} ${formatCurrency(result.amount)} on ${result.date}. Items: ${result.lineItems.join("; ")}`.slice(0, 500);
    const response = await fetch("/api/transactions/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_id: result.matchedTransactionId,
        note,
        tags: ["receipt"],
      }),
    });
    setStatus(response.ok ? "Attached to the matching transaction." : "Could not attach the note.");
  }

  return (
    <Panel title="Scan a receipt" eyebrow="Photo to ledger">
      <p className="mb-4 text-sm text-muted">
        Upload a receipt photo; the AI extracts merchant, total, and line
        items and finds the matching transaction. The image is processed by
        the AI provider and never stored.
      </p>
      {!enabled && (
        <p className="mb-3 text-xs text-warning">Enable AI insights above to use this.</p>
      )}
      <form onSubmit={scan} className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept="image/*" required disabled={!enabled || busy} className="max-w-xs" />
        <Button type="submit" size="md" disabled={!enabled || busy}>
          {busy ? "Reading…" : "Scan"}
        </Button>
      </form>

      {result && (
        <div className="mt-3 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
          <p className="font-semibold">
            {result.merchant} — {formatCurrency(result.amount)} on {result.date}
          </p>
          {result.lineItems.length > 0 && (
            <p className="mt-1 text-xs text-muted">{result.lineItems.join(" · ")}</p>
          )}
          <p className="mt-2 text-xs">
            {result.matchedTransactionId ? (
              <Button onClick={attach} variant="ghost" size="sm">
                Attach to matching transaction
              </Button>
            ) : (
              <span className="text-muted">No matching ledger transaction found.</span>
            )}
          </p>
        </div>
      )}
      {status && <p className="mt-2 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
