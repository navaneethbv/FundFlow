"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import {
  goalMonthlyPace,
  goalProgressPct,
  goalRemainingAmount,
  type Goal,
} from "@/lib/goals";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

type GoalDraft = {
  name: string;
  targetAmount: string;
  savedAmount: string;
  targetDate: string;
};

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
  onUpdate,
  onRemove,
}: {
  goal: Goal;
  monthlyNet: number;
  onContribute: (id: string, amount: number) => Promise<void>;
  onUpdate: (id: string, draft: GoalDraft) => Promise<boolean>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GoalDraft>({
    name: goal.name,
    targetAmount: String(goal.target_amount),
    savedAmount: String(goal.saved_amount),
    targetDate: goal.target_date ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pct = goalProgressPct(goal.saved_amount, goal.target_amount);
  const complete = pct >= 100;
  const remainingAmount = goalRemainingAmount(goal);
  const monthlyPace = goalMonthlyPace(goal);
  const isEditing = editingGoalId === goal.id;

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

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const saved = await onUpdate(goal.id, draft);
    setBusy(false);
    if (saved) {
      setEditingGoalId(null);
    } else {
      setError("Could not save changes. Your previous goal values were restored.");
    }
  }

  return (
    <li className="rounded-card border border-panel-border bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{goal.name}</p>
            {complete && <Badge tone="success">Goal complete</Badge>}
          </div>
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
        {formatCurrency(Math.abs(monthlyNet))} saved.{" "}
        {remainingAmount > 0
          ? `${formatCurrency(remainingAmount)} remaining${
              monthlyPace ? `, ${formatCurrency(monthlyPace)} needed monthly` : ""
            }.`
          : "This goal is fully funded."}
      </p>

      {isEditing ? (
        <form onSubmit={saveEdit} className="mt-3 grid gap-2 sm:grid-cols-4">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label="Target">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={draft.targetAmount}
              onChange={(e) => setDraft((d) => ({ ...d, targetAmount: e.target.value }))}
            />
          </Field>
          <Field label="Saved">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={draft.savedAmount}
              onChange={(e) => setDraft((d) => ({ ...d, savedAmount: e.target.value }))}
            />
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={draft.targetDate}
              onChange={(e) => setDraft((d) => ({ ...d, targetDate: e.target.value }))}
            />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-4">
            <Button type="submit" size="sm" loading={busy}>
              Save changes
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingGoalId(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditingGoalId(goal.id)}>
            Edit goal
          </Button>
        </div>
      )}

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

  function restoreGoals(snapshot: Goal[], message: string) {
    setGoals(snapshot);
    setError(message);
  }

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
    const snapshot = goals;
    const newTotal = Math.round((goal.saved_amount + amount) * 100) / 100;
    setGoals((g) => g.map((x) => (x.id === id ? { ...x, saved_amount: newTotal } : x)));
    const { error: updateError } = await supabase
      .from("goals")
      .update({ saved_amount: newTotal })
      .eq("id", id);
    if (updateError) {
      restoreGoals(snapshot, updateError.message);
      return;
    }
  }

  async function updateGoal(id: string, draft: GoalDraft): Promise<boolean> {
    const snapshot = goals;
    const parsedTarget = Number(draft.targetAmount);
    const parsedSaved = Number(draft.savedAmount);
    if (
      !draft.name.trim() ||
      !Number.isFinite(parsedTarget) ||
      parsedTarget <= 0 ||
      !Number.isFinite(parsedSaved) ||
      parsedSaved < 0
    ) {
      setError("Enter a name, a positive target, and a saved amount of zero or more.");
      return false;
    }
    const nextGoal: Partial<Goal> = {
      name: draft.name.trim(),
      target_amount: Math.round(parsedTarget * 100) / 100,
      saved_amount: Math.round(parsedSaved * 100) / 100,
      target_date: draft.targetDate || null,
    };
    setGoals((g) => g.map((x) => (x.id === id ? { ...x, ...nextGoal } : x)));
    const { error: updateError } = await supabase.from("goals").update(nextGoal).eq("id", id);
    if (updateError) {
      restoreGoals(snapshot, updateError.message);
      return false;
    }
    return true;
  }

  async function remove(id: string) {
    const snapshot = goals;
    setGoals((g) => g.filter((x) => x.id !== id));
    const { error: deleteError } = await supabase.from("goals").delete().eq("id", id);
    if (deleteError) {
      restoreGoals(snapshot, deleteError.message);
    }
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
              onUpdate={updateGoal}
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
