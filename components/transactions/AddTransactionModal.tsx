"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { localDateKey } from "@/lib/format-date";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export interface AddTransactionAccountOption {
  id: string;
  name: string;
  source: "plaid" | "manual";
}

interface GoalOption {
  id: string;
  name: string;
}

/**
 * Manual ledger entries for anything Plaid doesn't cover. A debit/credit
 * toggle rather than a signed amount field — asking "money in or out" reads
 * clearer than asking someone to remember Plaid's sign convention.
 */
export default function AddTransactionModal({
  accounts,
  goals = [],
  categories = [],
}: Readonly<{
  accounts: AddTransactionAccountOption[];
  goals?: GoalOption[];
  categories?: string[];
}>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"debit" | "credit">("debit");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(() => localDateKey());
  const [accountKey, setAccountKey] = useState(accounts[0] ? `${accounts[0].source}:${accounts[0].id}` : "");
  const [category, setCategory] = useState("");
  const [goalId, setGoalId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDialogKeyDown = useDialogFocus(dialogRef, open, () => setOpen(false));

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add transaction</Button>;
  }

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const [source, id] = accountKey.split(":");
    if (!source || !id) {
      setError("Choose an account.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/transactions/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          amount: Number(amount),
          merchant,
          date,
          account: { source, id },
          category: category || null,
          goalId: goalId || null,
          notes: notes || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not add the transaction.");
        return;
      }
      setOpen(false);
      setAmount("");
      setMerchant("");
      setNotes("");
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
        aria-labelledby="add-txn-title"
        onKeyDown={handleDialogKeyDown}
        className="relative m-0 w-full max-w-md rounded-card border border-panel-border bg-panel p-5 shadow-float sm:p-6"
      >
        <h2 id="add-txn-title" className="text-lg font-bold">Add transaction</h2>
        <form
          onSubmit={submit}
          className="mt-4 space-y-3"
        >
          <div className="flex gap-2">
            <Button
              type="button"
              variant={kind === "debit" ? "primary" : "secondary"}
              onClick={() => setKind("debit")}
            >
              Debit (money out)
            </Button>
            <Button
              type="button"
              variant={kind === "credit" ? "primary" : "secondary"}
              onClick={() => setKind("credit")}
            >
              Credit (money in)
            </Button>
          </div>
          <Field label="Amount" htmlFor="add-txn-amount">
            <Input id="add-txn-amount" type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Merchant" htmlFor="add-txn-merchant">
            <Input id="add-txn-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} required maxLength={120} />
          </Field>
          <Field label="Date" htmlFor="add-txn-date">
            <Input
              id="add-txn-date"
              type="date"
              value={date}
              max={localDateKey()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Account" htmlFor="add-txn-account">
            <Select id="add-txn-account" value={accountKey} onChange={(e) => setAccountKey(e.target.value)}>
              {accounts.map((a) => (
                <option key={`${a.source}:${a.id}`} value={`${a.source}:${a.id}`}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category (optional)" htmlFor="add-txn-category">
            <Input
              id="add-txn-category"
              list="add-transaction-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id="add-transaction-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          {goals.length > 0 && (
            <Field label="Link to a goal (optional)" htmlFor="add-txn-goal">
              <Select id="add-txn-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">None</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Notes (optional)" htmlFor="add-txn-notes">
            <Input id="add-txn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
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
