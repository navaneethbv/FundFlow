"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";

type Action = "tag" | "category" | "exclude" | "reviewed" | "collection";

const ACTIONS: Array<{ action: Action; label: string; needsValue?: boolean }> = [
  { action: "tag", label: "Add tag", needsValue: true },
  { action: "category", label: "Set category", needsValue: true },
  { action: "collection", label: "Add to collection", needsValue: true },
  { action: "exclude", label: "Exclude" },
  { action: "reviewed", label: "Mark reviewed" },
];

function selectedIds(): string[] {
  return [...new Set(Array.from(document.querySelectorAll<HTMLInputElement>("input[data-bulk-select]:checked"))
    .map((input) => input.dataset.transactionId)
    .filter((id): id is string => Boolean(id)))];
}

export default function BulkEditBar({ enabled }: Readonly<{ enabled: boolean }>) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const sync = () => setIds(selectedIds());
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [enabled]);

  if (!enabled || (ids.length === 0 && !status)) return null;

  async function apply(nextAction: Action) {
    const descriptor = ACTIONS.find((item) => item.action === nextAction);
    if (descriptor?.needsValue && !value.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      const versions = ids.map((id) => ({ id, version: document.querySelector<HTMLInputElement>(`[data-review-version="${id}"]`)?.value ?? "1" }));
      const response = await fetch("/api/transactions/bulk-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transaction_ids: ids, action: nextAction, value: value.trim(), versions }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string; updated?: number } | null;
      if (!response.ok) throw new Error(json?.error ?? "Bulk edit failed");
      setStatus(`${json?.updated ?? ids.length} transaction${ids.length === 1 ? "" : "s"} updated`);
      document.querySelectorAll<HTMLInputElement>("input[data-bulk-select]:checked").forEach((input) => { input.checked = false; });
      setIds([]);
      setAction(null);
      setValue("");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bulk edit failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-card border border-accent/30 bg-panel px-3 py-2 shadow-float sm:bottom-4" aria-label="Bulk transaction actions">
        <span className="mr-auto text-sm font-semibold">{ids.length} selected</span>
        {ACTIONS.map((item) => (
          <Button key={item.action} type="button" size="sm" variant={item.action === "exclude" ? "ghost" : "secondary"} onClick={() => item.needsValue ? setAction(item.action) : void apply(item.action)} disabled={saving}>
            {item.label}
          </Button>
        ))}
        {status && <output className="basis-full text-xs text-muted" aria-live="polite">{status}</output>}
      </div>
      <Modal open={action !== null} onClose={() => setAction(null)} placement="sheet" titleId="bulk-edit-title">
        <h2 id="bulk-edit-title" className="text-base font-bold">Bulk edit</h2>
        <p className="mt-1 text-sm text-muted">Apply this change to {ids.length} selected transactions.</p>
        <label htmlFor="bulk-edit-value" className="mt-4 block text-sm font-semibold">{action === "collection" ? "Collection name" : action === "category" ? "Category or display name" : "Tag"}</label>
        <Input id="bulk-edit-value" value={value} onChange={(event) => setValue(event.target.value)} className="mt-1" autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
          <Button type="button" onClick={() => action && void apply(action)} loading={saving}>Apply</Button>
        </div>
      </Modal>
    </>
  );
}
