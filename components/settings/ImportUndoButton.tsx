"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function ImportUndoButton({ batchId }: Readonly<{ batchId: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo(): Promise<void> {
    if (!window.confirm("Undo this import? Only rows from this batch will be removed.")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/import/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "This import could not be undone safely.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This import could not be undone safely.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => void undo()}>
        Undo import
      </Button>
      {error && <p role="alert" className="max-w-xs text-right text-xs text-danger">{error}</p>}
    </div>
  );
}
