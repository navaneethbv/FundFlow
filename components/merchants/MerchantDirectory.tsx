"use client";

import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import { MerchantAvatar } from "@/components/ui/Avatar";
import { merchantLogoDataUri } from "@/lib/merchant-logos";
import { formatCurrency } from "@/lib/format";
import type { MerchantDirectoryRow } from "@/lib/merchant-directory";

export default function MerchantDirectory({ initialRows }: Readonly<{ initialRows: MerchantDirectoryRow[] }>) {
  const [rows, setRows] = useState(initialRows);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function merge(event: React.SyntheticEvent) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch("/api/merchants/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source_merchant: source, target_merchant: target }) });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) { setMessage(payload.error ?? "Could not merge merchants."); return; }
    setRows((current) => current.filter((row) => row.merchant.toLowerCase() !== source.trim().toLowerCase()));
    setSource(""); setTarget(""); setMessage("Merchant alias saved. Existing transactions keep their provider value.");
  }
  return (
    <Panel title="Merchants" eyebrow="Spend by normalized name">
      <div className="divide-y divide-panel-border">
        {rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-3"><div className="flex min-w-0 items-center gap-3"><MerchantAvatar name={row.merchant} logoUrl={merchantLogoDataUri(row.merchant)} size={32} /><div className="min-w-0"><p className="truncate font-semibold">{row.merchant}</p><p className="text-xs text-muted">{row.count} transactions · last seen {row.lastSeen}{row.category ? ` · ${row.category}` : ""}</p><Link className="text-xs underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" href={`/transactions?merchant=${encodeURIComponent(row.merchant)}`}>View transaction history</Link></div></div><span data-money className="font-semibold">{formatCurrency(row.total)}</span></div>)}
      </div>
      <form onSubmit={merge} className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><Field label="Merge from" htmlFor="merchant-source"><Input id="merchant-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Store variation" required /></Field><Field label="Keep as" htmlFor="merchant-target"><Input id="merchant-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Canonical merchant" required /></Field><Button type="submit">Save alias</Button></form>
      {message && <output className="mt-2 block text-sm text-muted" aria-live="polite">{message}</output>}
    </Panel>
  );
}
