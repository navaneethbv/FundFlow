"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetInput } from "@/lib/manual-assets";
import { parseAssetInput } from "@/lib/manual-assets";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import FormMessage from "@/components/ui/FormMessage";

export default function ManualAssetForm({ initial, today }: Readonly<{ initial?: AssetInput; today: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const str = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : "";
    };
    const nullableNumber = (key: string) => str(key) === "" ? null : Number(str(key));
    const parsed = parseAssetInput({
      ...(initial?.id ? { id: initial.id, version: initial.version } : {}),
      name: str("name"), assetKind: str("assetKind"), value: nullableNumber("value"),
      valuationDate: str("valuationDate"), valueSource: str("valueSource"), ownershipPercentage: nullableNumber("ownershipPercentage"),
      purchasePrice: nullableNumber("purchasePrice"), purchaseDate: str("purchaseDate") || null,
      growth: str("growthKind") === "none" ? null : { kind: str("growthKind"), amount: nullableNumber("growthAmount"), period: str("growthPeriod"), startDate: str("growthStart") || null },
    }, today);
    if (typeof parsed === "string") { setMessage(parsed); return; }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/manual-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const payload = await response.json();
      if (!response.ok) { setMessage(payload.error ?? "Could not save the asset."); return; }
      setMessage("Valuation saved.");
      router.push(`/accounts/assets?asset=${encodeURIComponent(payload.id)}`);
      router.refresh();
    } catch { setMessage("Could not reach the server. Your entered details are still here."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <legend className="mb-3 font-semibold">{initial ? "Record a valuation" : "Add a manual asset"}</legend>
      <Field label="Name" htmlFor="asset-name"><Input id="asset-name" name="name" required maxLength={120} defaultValue={initial?.name} /></Field>
      <Field label="Kind" htmlFor="asset-kind"><Select id="asset-kind" name="assetKind" defaultValue={initial?.assetKind ?? "property"}><option value="property">Property</option><option value="vehicle">Vehicle</option><option value="other">Other</option></Select></Field>
      <Field label="Full value (USD)" htmlFor="asset-value"><Input id="asset-value" name="value" type="number" min="0" step="0.01" required defaultValue={initial?.value} /></Field>
      <Field label="Valuation date" htmlFor="asset-date"><Input id="asset-date" name="valuationDate" type="date" required max={today} min={initial?.valuationDate} defaultValue={initial?.valuationDate ?? today} /></Field>
      <Field label="Value source" htmlFor="asset-source"><Input id="asset-source" name="valueSource" required maxLength={120} placeholder="Appraisal, purchase invoice, or own estimate" defaultValue={initial?.valueSource} /></Field>
      <Field label="Ownership (%)" htmlFor="asset-share"><Input id="asset-share" name="ownershipPercentage" type="number" min="0.01" max="100" step="0.01" required defaultValue={initial?.ownershipPercentage ?? 100} /></Field>
      <Field label="Purchase price (USD, optional)" htmlFor="asset-purchase"><Input id="asset-purchase" name="purchasePrice" type="number" min="0" step="0.01" defaultValue={initial?.purchasePrice ?? ""} /></Field>
      <Field label="Purchase date (optional)" htmlFor="asset-purchase-date"><Input id="asset-purchase-date" name="purchaseDate" type="date" max={today} defaultValue={initial?.purchaseDate ?? ""} /></Field>
      <Field label="Growth assumption" htmlFor="asset-growth"><Select id="asset-growth" name="growthKind" defaultValue={initial?.growth?.kind ?? "none"}><option value="none">None</option><option value="percent">Percent</option><option value="absolute">USD amount</option></Select></Field>
      <Field label="Growth amount (negative for depreciation)" htmlFor="asset-growth-amount"><Input id="asset-growth-amount" name="growthAmount" type="number" step="0.01" defaultValue={initial?.growth?.amount ?? 0} /></Field>
      <Field label="Growth period" htmlFor="asset-period"><Select id="asset-period" name="growthPeriod" defaultValue={initial?.growth?.period ?? "year"}><option value="month">Monthly</option><option value="year">Yearly</option></Select></Field>
      <Field label="Growth start (optional)" htmlFor="asset-start"><Input id="asset-start" name="growthStart" type="date" defaultValue={initial?.growth?.startDate ?? ""} /></Field>
    </fieldset>
    <p className="text-sm text-muted">Growth applies on completed anniversaries after the valuation or later start date. Percent changes compound; USD changes add. Values stop at zero. Growth values are labelled Estimate. Net worth counts only your owned share.</p>
    <Button type="submit" loading={busy}>Save valuation</Button>
    <FormMessage message={message} />
  </form>;
}
