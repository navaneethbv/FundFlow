"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import type { AccountOption } from "@/lib/investments-data";

/**
 * Manual holdings exist for whatever a provider doesn't cover — a private
 * fund, an employer stock plan, cash on the sidelines. Quantity, price, and
 * date are all required: there's no "we'll estimate it" path for a value the
 * app cannot verify itself.
 */
export default function AddManualHoldingForm({
  accounts,
}: Readonly<{ accounts: AccountOption[] }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [securityName, setSecurityName] = useState("");
  const [accountKey, setAccountKey] = useState(accounts[0] ? `${accounts[0].source}:${accounts[0].id}` : "");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add holding
      </Button>
    );
  }

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const [source, id] = accountKey.split(":");
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(price);
    if (!source || !id) {
      setError("Choose an account.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/investments/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountSource: source,
          accountId: id,
          securityName,
          quantity: parsedQuantity,
          price: parsedPrice,
          asOf,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not add the holding.");
        return;
      }
      setOpen(false);
      setSecurityName("");
      setQuantity("");
      setPrice("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-card border border-panel-border bg-panel p-4">
      <Field label="Security name">
        <Input value={securityName} onChange={(e) => setSecurityName(e.target.value)} required maxLength={160} />
      </Field>
      <Field label="Account">
        <Select value={accountKey} onChange={(e) => setAccountKey(e.target.value)}>
          {accounts.map((a) => (
            <option key={`${a.source}:${a.id}`} value={`${a.source}:${a.id}`}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity">
          <Input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
        <Field label="Price">
          <Input
            type="number"
            step="any"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="As of">
        <Input
          type="date"
          value={asOf}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setAsOf(e.target.value)}
          required
        />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
