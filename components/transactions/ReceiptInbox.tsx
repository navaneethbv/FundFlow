"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { ReceiptInboxRow } from "@/lib/receipt-data";

const STATUS_ORDER: Record<ReceiptInboxRow["status"], number> = {
  unmatched: 0,
  matched: 1,
  ignored: 2,
};

export default function ReceiptInbox({
  initialReceipts,
}: Readonly<{
  initialReceipts: ReceiptInboxRow[];
}>) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...receipts].sort((left, right) =>
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
      right.created_at.localeCompare(left.created_at),
    ),
    [receipts],
  );

  async function upload(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/receipts", { method: "POST", body: form });
      const result = await response.json().catch(() => null) as {
        receipt?: ReceiptInboxRow;
        error?: string;
      } | null;
      if (!response.ok || !result?.receipt) {
        setError(result?.error ?? "Could not upload the receipt.");
        return;
      }
      setReceipts((rows) => [result.receipt!, ...rows]);
      formElement.reset();
    } catch {
      setError("Could not upload the receipt.");
    } finally {
      setUploading(false);
    }
  }

  async function transition(
    receiptId: string,
    action: "attach" | "ignore" | "restore",
    transactionId?: string,
  ) {
    setError(null);
    setBusyId(receiptId);
    try {
      const response = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, transactionId }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? "Could not update the receipt.");
        return;
      }
      setReceipts((rows) => rows.map((receipt) => {
        if (receipt.id !== receiptId) return receipt;
        if (action === "attach") {
          return { ...receipt, transaction_id: transactionId ?? null, status: "matched" };
        }
        return {
          ...receipt,
          transaction_id: null,
          status: action === "ignore" ? "ignored" : "unmatched",
        };
      }));
    } catch {
      setError("Could not update the receipt.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(receiptId: string) {
    setError(null);
    setBusyId(receiptId);
    try {
      const response = await fetch(`/api/receipts/${receiptId}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? "Could not delete the receipt.");
        return;
      }
      setReceipts((rows) => rows.filter((receipt) => receipt.id !== receiptId));
    } catch {
      setError("Could not delete the receipt.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Upload receipt" eyebrow="Private image storage">
        <form onSubmit={upload} className="grid items-end gap-3 md:grid-cols-4">
          <Field label="Image">
            <Input
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              required
            />
          </Field>
          <Field label="Merchant (optional)">
            <Input name="merchant" maxLength={160} placeholder="Corner Cafe" />
          </Field>
          <Field label="Purchase date (optional)">
            <Input name="purchaseDate" type="date" />
          </Field>
          <Field label="Total (optional)">
            <Input name="total" type="number" min="0.01" step="0.01" placeholder="24.50" />
          </Field>
          <div className="md:col-span-full">
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload receipt"}
            </Button>
          </div>
        </form>
      </Panel>

      {error && (
        <output className="block rounded-field border border-danger/30 bg-panel p-3 text-sm text-danger">
          {error}
        </output>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          title="No saved receipts"
          description="Upload a receipt to match it with an existing transaction."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sorted.map((receipt) => (
            <Panel
              key={receipt.id}
              title={receipt.merchant ?? "Unlabeled receipt"}
              eyebrow={receipt.status === "unmatched" ? "Needs review" : receipt.status}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted">
                  {receipt.purchase_date ?? "Date unknown"}
                  {receipt.total === null ? "" : ` · ${formatCurrency(receipt.total)}`}
                </p>
                <a
                  href={receipt.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-accent hover:underline"
                >
                  Open image
                </a>
              </div>

              {receipt.status === "unmatched" && receipt.candidates.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Candidate transactions
                  </p>
                  {receipt.candidates.map((candidate) => (
                    <div
                      key={candidate.transactionId}
                      className="flex items-center justify-between gap-3 rounded-field border border-panel-border bg-panel-2 p-3 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {candidate.merchant} · {candidate.date} · {formatCurrency(Math.abs(candidate.amount))}
                      </span>
                      <Button
                        size="sm"
                        disabled={busyId === receipt.id}
                        onClick={() => void transition(receipt.id, "attach", candidate.transactionId)}
                      >
                        Attach
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {receipt.status === "unmatched" && receipt.candidates.length === 0 && (
                <p className="mt-4 text-sm text-muted">No matching transaction candidate found.</p>
              )}

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {receipt.status === "unmatched" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === receipt.id}
                    onClick={() => void transition(receipt.id, "ignore")}
                  >
                    Ignore
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === receipt.id}
                    onClick={() => void transition(receipt.id, "restore")}
                  >
                    Restore
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === receipt.id}
                  onClick={() => void remove(receipt.id)}
                >
                  Delete
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
