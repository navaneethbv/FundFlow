"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { Plus } from "@/components/ui/icons";
import type { AccountOption } from "@/lib/investments-data";

/**
 * Manual holdings exist for whatever a provider doesn't cover — a private
 * fund, an employer stock plan, cash on the sidelines. Quantity, price, and
 * date are all required: there's no "we'll estimate it" path for a value the
 * app cannot verify itself.
 *
 * Renders as the standard app modal (`bg-black/50` + `rounded-card` +
 * `shadow-float`, same as `SeedBudgetButton`/`CustomizeDrawer`) — an inline
 * expanding form in the page header would have pushed header content around.
 */
export default function AddManualHoldingForm({
  accounts,
}: Readonly<{ accounts: AccountOption[] }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [securityName, setSecurityName] = useState("");
  const [accountKey, setAccountKey] = useState(accounts[0] ? `${accounts[0].source}:${accounts[0].id}` : "");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const firstControl = dialogRef.current?.querySelector<HTMLElement>(
      "input, select, button",
    );
    firstControl?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden className="h-4 w-4" />
        Add Holding
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <dialog
        open
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby="add-holding-title"
        className="relative m-0 w-full max-w-md rounded-card border border-panel-border bg-panel p-5 shadow-float sm:p-6"
      >
        <h2 id="add-holding-title" className="text-xl font-bold">
          Add Holding
        </h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
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
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
