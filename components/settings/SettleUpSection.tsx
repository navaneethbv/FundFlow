"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { computeSettleUp } from "@/lib/insights";
import { formatCurrency } from "@/lib/format";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";

export interface HouseholdMemberInfo {
  userId: string;
  email: string;
}

interface ExpenseRow {
  id: string;
  paid_by: string;
  owed_user_id: string;
  description: string;
  amount: number;
  settled_at: string | null;
}

/**
 * Settle-up ledger (4.4): each partner records what they paid; the running
 * balance nets to one "X owes Y" line via computeSettleUp. Rows live in
 * shared_expenses under household RLS.
 */
export default function SettleUpSection({
  householdId,
  currentUserId,
  members,
  initialExpenses,
}: {
  householdId: string;
  currentUserId: string;
  members: HouseholdMemberInfo[];
  initialExpenses: ExpenseRow[];
}) {
  const supabase = createClient();
  const [expenses, setExpenses] = useState(initialExpenses);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const others = members.filter((member) => member.userId !== currentUserId);
  const [owedBy, setOwedBy] = useState(others[0]?.userId ?? "");
  const [error, setError] = useState<string | null>(null);

  const emailOf = (userId: string) =>
    members.find((member) => member.userId === userId)?.email ?? "partner";

  const open = expenses.filter((expense) => !expense.settled_at);
  const balance = computeSettleUp(
    open.map((expense) => ({
      paidBy: expense.paid_by,
      owedBy: expense.owed_user_id,
      amount: Number(expense.amount),
    })),
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Number(amount);
    if (!description.trim() || !Number.isFinite(parsed) || parsed <= 0 || !owedBy) {
      setError("Enter a description, a positive amount, and who owes it.");
      return;
    }
    const { data, error: insertError } = await supabase
      .from("shared_expenses")
      .insert({
        household_id: householdId,
        paid_by: currentUserId,
        owed_user_id: owedBy,
        description: description.trim(),
        amount: parsed,
      })
      .select("id, paid_by, owed_user_id, description, amount, settled_at")
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setExpenses((rows) => [...rows, data as ExpenseRow]);
    setDescription("");
    setAmount("");
  }

  async function settleAll() {
    setError(null);
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("shared_expenses")
      .update({ settled_at: now })
      .eq("household_id", householdId)
      .is("settled_at", null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setExpenses((rows) =>
      rows.map((row) => (row.settled_at ? row : { ...row, settled_at: now })),
    );
  }

  return (
    <Panel title="Settle up" eyebrow="Shared expenses">
      {balance ? (
        <p className="mb-3 text-sm">
          <span className="font-bold">{emailOf(balance.from)}</span> owes{" "}
          <span className="font-bold">{emailOf(balance.to)}</span>{" "}
          <span className="metric-value">{formatCurrency(balance.amount)}</span>
          <Button onClick={settleAll} variant="ghost" size="sm" className="ml-3">
            Mark settled
          </Button>
        </p>
      ) : (
        <p className="mb-3 text-sm text-muted">All settled up.</p>
      )}

      {open.length > 0 && (
        <ul className="mb-4 space-y-1.5 text-sm">
          {open.map((expense) => (
            <li key={expense.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {expense.description}
                <span className="text-xs text-muted"> · paid by {emailOf(expense.paid_by)}</span>
              </span>
              <span className="metric-value shrink-0">
                {formatCurrency(Number(expense.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <Field label="I paid for">
            <Input
              placeholder="Groceries"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Their share">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="45.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28"
            />
          </Field>
          <Field label="Owed by">
            <Select value={owedBy} onChange={(e) => setOwedBy(e.target.value)}>
              {others.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.email}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" size="md">
            Add
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted">
          Invite a partner above to start splitting expenses.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
