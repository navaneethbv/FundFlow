"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface FundRow {
  id: string;
  name: string;
  target_amount: number;
  due_date: string;
}

/**
 * Sinking funds (Bucket 2): planned irregular expenses (car insurance,
 * holidays) smoothed into a monthly set-aside. The Plan view shows the
 * per-month reserve, and funds due soon count against Safe to Spend.
 */
export default function SinkingFundsSection({
  initialFunds,
}: {
  initialFunds: FundRow[];
}) {
  const supabase = createClient();
  const [funds, setFunds] = useState(initialFunds);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Number(amount);
    if (!name.trim() || !Number.isFinite(parsed) || parsed <= 0 || !dueDate) {
      setError("Enter a name, a positive amount, and a due date.");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("sinking_funds")
      .insert({
        user_id: userData.user?.id,
        name: name.trim(),
        target_amount: parsed,
        due_date: dueDate,
      })
      .select("id, name, target_amount, due_date")
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setFunds((rows) => [...rows, data as FundRow]);
    setName("");
    setAmount("");
    setDueDate("");
  }

  async function remove(id: string) {
    await supabase.from("sinking_funds").delete().eq("id", id);
    setFunds((rows) => rows.filter((row) => row.id !== id));
  }

  return (
    <Panel title="Sinking funds" eyebrow="Planned irregular expenses">
      <p className="mb-4 text-sm text-muted">
        Smooth big known expenses into a monthly set-aside — the Plan view
        shows what to reserve, and anything due soon reduces Safe to Spend.
      </p>

      {funds.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {funds.map((fund) => (
            <li key={fund.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{fund.name}</span>
                <span className="text-xs text-muted">
                  {" "}
                  · {formatCurrency(Number(fund.target_amount))} by {fund.due_date}
                </span>
              </span>
              <Button onClick={() => remove(fund.id)} variant="ghost" size="sm">
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Name">
          <Input placeholder="Car insurance" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input
            type="number"
            min="1"
            step="0.01"
            placeholder="600"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28"
          />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Button type="submit" size="md">
          Add
        </Button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
