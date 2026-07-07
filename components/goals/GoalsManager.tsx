"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { goalProgressPct, type Goal } from "@/lib/goals";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

function formatTargetDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function GoalRow({
  goal,
  monthlyNet,
  onContribute,
  onRemove,
}: {
  goal: Goal;
  monthlyNet: number;
  onContribute: (id: string, amount: number) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pct = goalProgressPct(goal.saved_amount, goal.target_amount);
  const complete = pct >= 100;

  async function contribute(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    await onContribute(goal.id, parsed);
    setBusy(false);
    setAmount("");
  }

  return (
    <li className="rounded-card border border-panel-border bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{goal.name}</p>
          {goal.target_date && (
            <p className="text-xs text-muted">Target date: {formatTargetDate(goal.target_date)}</p>
          )}
        </div>
        <p className="shrink-0 text-right text-sm font-bold tabular-nums">
          {formatCurrency(goal.saved_amount)}
          <span className="text-muted"> / {formatCurrency(goal.target_amount)}</span>
        </p>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="block h-2 flex-1 rounded-full bg-panel-hover">
          <span
            className="block h-2 rounded-full"
            style={{
              width: `${pct}%`,
              backgroundColor: complete ? "var(--viz-good)" : "var(--accent)",
            }}
          />
        </span>
        <span className="shrink-0 text-xs font-bold tabular-nums">{pct}%</span>
      </div>

      <p className="mt-2 text-xs text-muted">
        This month: {monthlyNet >= 0 ? "+" : "-"}
        {formatCurrency(Math.abs(monthlyNet))} saved
      </p>

      <form onSubmit={contribute} className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Add contribution">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28"
          />
        </Field>
        <Button type="submit" size="sm" loading={busy}>
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(goal.id)}>
          Delete
        </Button>
      </form>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </li>
  );
}

export default function GoalsManager({
  initialGoals,
  monthlyNet,
}: {
  initialGoals: Goal[];
  monthlyNet: number;
}) {
  const supabase = createClient();
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedTarget = Number(target);
    if (!name.trim() || !Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError("Enter a name and a target amount greater than zero.");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("goals")
      .insert({
        user_id: userData.user?.id,
        name: name.trim(),
        target_amount: parsedTarget,
        target_date: targetDate || null,
      })
      .select("id, name, target_amount, saved_amount, target_date")
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setGoals((g) => [...g, data as Goal]);
    setName("");
    setTarget("");
    setTargetDate("");
  }

  async function contribute(id: string, amount: number) {
    const goal = goals.find((g) => g.id === id);
    if (!goal) return;
    const newTotal = Math.round((goal.saved_amount + amount) * 100) / 100;
    const { error: updateError } = await supabase
      .from("goals")
      .update({ saved_amount: newTotal })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setGoals((g) => g.map((x) => (x.id === id ? { ...x, saved_amount: newTotal } : x)));
  }

  async function remove(id: string) {
    await supabase.from("goals").delete().eq("id", id);
    setGoals((g) => g.filter((x) => x.id !== id));
  }

  return (
    <Panel title="Savings goals" eyebrow="Targets and progress">
      {goals.length > 0 ? (
        <ul className="mb-6 space-y-3">
          {goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              monthlyNet={monthlyNet}
              onContribute={contribute}
              onRemove={remove}
            />
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-muted">No goals yet. Add your first savings target below.</p>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Goal name">
          <Input
            placeholder="Emergency fund"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Target amount">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="10000"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-32"
          />
        </Field>
        <Field label="Target date (optional)" htmlFor="goal-target-date">
          <Input
            id="goal-target-date"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
        <Button type="submit" size="md">
          Add goal
        </Button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
