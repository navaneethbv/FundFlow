"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Panel from "@/components/ui/Panel";
import { SUBSCRIPTION_CATALOG } from "@/lib/subscription-catalog";

export default function SubscriptionCatalog() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nextDate, setNextDate] = useState("");

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function addSelected() {
    if (!nextDate || selected.length === 0) {
      setError("Choose at least one subscription and a next due date.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const responses = await Promise.all(selected.map((id) => {
        const entry = SUBSCRIPTION_CATALOG.find((item) => item.id === id)!;
        return fetch("/api/recurring/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: entry.name, amount: entry.typicalAmount, frequency: entry.frequency, next_date: nextDate, item_type: "expense", category: null }),
        });
      }));
      if (responses.some((response) => !response.ok)) {
        setError("One or more items did not save. Review the recurring list and try again.");
        return;
      }
      setSelected([]);
      setNextDate("");
      router.refresh();
    });
  }

  return (
    <Panel title="Common subscriptions" eyebrow="Quick add">
      <p className="text-sm text-muted">Typical starting amounts are prompts. Edit each item after adding it.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {SUBSCRIPTION_CATALOG.map((entry) => (
          <label key={entry.id} className="flex min-h-11 items-center justify-between gap-3 rounded-field border border-panel-border bg-panel-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={selected.includes(entry.id)} onChange={() => toggle(entry.id)} disabled={pending} />
              <span>{entry.name}</span>
            </span>
            <span className="whitespace-nowrap text-xs text-muted">Typical {entry.frequency === "yearly" ? "yearly" : "monthly"} · {entry.typicalAmount.toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold">First due date<input aria-label="Subscription first due date" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} disabled={pending} className="mt-1 block min-h-11 rounded-field border border-panel-border bg-background px-3" /></label>
        <button type="button" onClick={addSelected} disabled={pending || selected.length === 0} className="min-h-11 rounded-field bg-accent px-4 text-sm font-semibold text-accent-foreground">Add selected</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
    </Panel>
  );
}
