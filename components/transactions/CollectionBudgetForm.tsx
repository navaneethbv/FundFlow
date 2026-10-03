"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

/** Parse a typed budget; "" clears it, otherwise zero or more with two decimals. */
export function parseCollectionBudget(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(trimmed) ? Number(trimmed) : "invalid";
}

/** Reference adoption 6.8: set or clear one collection's optional budget. */
export default function CollectionBudgetForm({ name, budget }: Readonly<{ name: string; budget: number | null }>) {
  const router = useRouter();
  const [text, setText] = useState(budget === null ? "" : String(budget));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputId = `collection-budget-${name.replace(/\W+/g, "-").toLowerCase()}`;

  async function save(event: React.SyntheticEvent) {
    event.preventDefault();
    const parsed = parseCollectionBudget(text);
    if (parsed === "invalid") return setMessage("Enter an amount with at most two decimals, or leave it empty.");
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/collections/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, budget: parsed }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(json?.error ?? "Could not save the budget.");
      setMessage(parsed === null ? "Budget cleared." : "Budget saved.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save the budget.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <label htmlFor={inputId} className="grid gap-1 text-xs font-semibold text-muted">
        Budget for {name}
        <Input id={inputId} inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} placeholder="No budget" className="w-32" />
      </label>
      <Button type="submit" variant="secondary" loading={saving}>Save</Button>
      {message && <output aria-live="polite" className="basis-full text-xs text-muted">{message}</output>}
    </form>
  );
}
