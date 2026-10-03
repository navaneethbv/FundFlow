"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface MappingRow { pfc_detailed: string; display_category: string }

export default function PlaidCategoryMappingSection({ initialMappings }: Readonly<{ initialMappings: MappingRow[] }>) {
  const [mappings, setMappings] = useState(initialMappings);
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function save(next: MappingRow[]) {
    setMessage(null);
    const response = await fetch("/api/settings/plaid-category-mappings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mappings: next }) });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) { setMessage(payload.error ?? "Could not save mappings."); return; }
    setMappings(next);
    setCode("");
    setCategory("");
    setMessage("Mappings saved.");
  }

  function add(event: React.SyntheticEvent) {
    event.preventDefault();
    const nextCode = code.trim().toUpperCase();
    const nextCategory = category.trim();
    if (!nextCode || !nextCategory) { setMessage("Enter a detailed Plaid code and category."); return; }
    void save([...mappings.filter((row) => row.pfc_detailed !== nextCode), { pfc_detailed: nextCode, display_category: nextCategory }]);
  }

  return (
    <Panel title="Plaid category mappings" eyebrow="Applied before merchant rules">
      <p className="mb-4 text-sm text-muted">Map provider detailed codes to your categories while preserving the raw provider value.</p>
      <ul className="mb-4 space-y-2 text-sm">{mappings.map((row) => <li key={row.pfc_detailed} className="flex items-center justify-between gap-3"><span><strong>{row.pfc_detailed}</strong><span className="text-muted"> → {row.display_category}</span></span><Button type="button" size="sm" variant="ghost" onClick={() => void save(mappings.filter((candidate) => candidate.pfc_detailed !== row.pfc_detailed))}>Remove</Button></li>)}</ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Detailed code" htmlFor="plaid-category-code"><Input id="plaid-category-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="FOOD.GROCERIES" /></Field>
        <Field label="FundFlow category" htmlFor="plaid-category-name"><Input id="plaid-category-name" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Groceries" /></Field>
        <Button type="submit">Save mapping</Button>
      </form>
      {message && <output className="mt-2 block text-sm text-muted" aria-live="polite">{message}</output>}
    </Panel>
  );
}
