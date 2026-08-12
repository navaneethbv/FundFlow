"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import type { WizardAccount } from "@/components/goals/GoalWizard";

/**
 * The wizard's funding step, standalone on a goal card.
 *
 * Allocations always go through `/api/goals/accounts`, never a direct insert:
 * the rules about entire-balance claims and over-allocation are cross-row, and
 * the database function holds a row lock while it checks them. This component
 * only collects the intent and reports whatever the server decided — it never
 * pre-judges an allocation as valid.
 */
export default function GoalAllocationPanel({
  goalId,
  accounts,
  linkedAccountIds,
}: Readonly<{
  goalId: string;
  accounts: WizardAccount[];
  linkedAccountIds: string[];
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [mode, setMode] = useState<"fixed" | "entire">("fixed");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linked = new Set(linkedAccountIds);
  const available = accounts.filter((account) => !linked.has(account.id));

  async function submit(submitEvent: React.SyntheticEvent) {
    submitEvent.preventDefault();
    setError(null);
    if (!accountId) {
      setError("Pick an account first.");
      return;
    }
    const parsedAmount = Number(amount);
    if (mode === "fixed" && (parsedAmount <= 0 || Number.isNaN(parsedAmount))) {
      setError("Enter an amount above zero.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/goals/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId,
          accountId,
          useEntireBalance: mode === "entire",
          allocatedAmount:
            mode === "fixed" ? Math.round(Number(amount) * 100) / 100 : undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? "That allocation could not be saved.");
        return;
      }
      setOpen(false);
      setAccountId("");
      setAmount("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(id: string) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/goals/accounts?goalId=${encodeURIComponent(goalId)}&accountId=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? "That account could not be unlinked.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Allocate funds
        </Button>
        {linkedAccountIds.map((id) => {
          const account = accounts.find((item) => item.id === id);
          return (
            <Button
              key={id}
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => unlink(id)}
            >
              Unlink {account?.name ?? "account"}
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-panel-border pt-3">
      {available.length === 0 ? (
        <p className="text-sm text-muted">
          Every account is already linked to this goal.
        </p>
      ) : (
        <>
          <label className="block text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">Account</span>
            <select
              value={accountId}
              onChange={(selectEvent) => setAccountId(selectEvent.target.value)}
              className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
            >
              <option value="">Choose an account</option>
              {available.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">How much of it</span>
            <select
              value={mode}
              onChange={(selectEvent) =>
                setMode(selectEvent.target.value as "fixed" | "entire")
              }
              className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
            >
              <option value="fixed">A fixed amount</option>
              <option value="entire">The entire balance</option>
            </select>
          </label>
          {mode === "fixed" && (
            <label className="block text-sm font-semibold">
              <span className="mb-1 block text-xs text-muted">Amount</span>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(inputEvent) => setAmount(inputEvent.target.value)}
              />
            </label>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || available.length === 0}>
          Save allocation
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
