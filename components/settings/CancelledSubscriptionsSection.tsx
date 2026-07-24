"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

/**
 * Cancellation watch (Bucket 2): mark a subscription merchant as cancelled;
 * if it ever charges again, the sync raises a danger alert.
 */
export default function CancelledSubscriptionsSection({
  initialMerchants,
}: {
  initialMerchants: string[];
}) {
  const [merchants, setMerchants] = useState(initialMerchants);
  const [merchant, setMerchant] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = merchant.trim();
    if (!name) return;
    const response = await fetch("/api/subscriptions/cancelled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: name }),
    });
    if (!response.ok) {
      setError("Could not add the watch.");
      return;
    }
    setMerchants((rows) => (rows.includes(name) ? rows : [...rows, name]));
    setMerchant("");
  }

  async function remove(name: string) {
    setError(null);
    const response = await fetch("/api/subscriptions/cancelled", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: name }),
    });
    if (!response.ok) {
      setError("Could not remove the watch.");
      return;
    }
    setMerchants((rows) => rows.filter((row) => row !== name));
  }

  return (
    <Panel title="Cancellation watch" eyebrow="Hold them to it">
      <p className="mb-4 text-sm text-muted">
        Cancelled a subscription? Add the merchant here (exactly as it
        appears in your ledger) and you&apos;ll get an alert if it ever
        charges you again.
      </p>

      {merchants.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {merchants.map((name) => (
            <li key={name} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-semibold">{name}</span>
              <Button onClick={() => remove(name)} variant="ghost" size="sm">
                Stop watching
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Merchant">
          <Input
            placeholder="Netflix"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />
        </Field>
        <Button type="submit" size="md">
          Watch
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
