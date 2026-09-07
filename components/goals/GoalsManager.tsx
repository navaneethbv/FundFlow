"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, inflowMarker } from "@/lib/format";
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
import FormMessage from "@/components/ui/FormMessage";

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
  footer = null,
}: Readonly<{
  goal: Goal;
  monthlyNet: number;
  onContribute: (id: string, amount: number) => Promise<void>;
  onUpdate: (id: string, draft: GoalDraft) => Promise<boolean>;
  onRemove: (id: string) => Promise<void>;
  footer?: React.ReactNode;
}>) {
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

  async function contribute(e: React.SyntheticEvent) {
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

  async function saveEdit(e: React.SyntheticEvent) {
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

  const paceSuffix = monthlyPace
    ? `, ${formatCurrency(monthlyPace)} needed monthly`
    : "";

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
          <span data-money>{formatCurrency(goal.saved_amount)}</span>
          <span className="text-muted"> / <span data-money>{formatCurrency(goal.target_amount)}</span></span>
        </p>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="block h-2 flex-1 rounded-full bg-panel-hover">
          <span
            className={complete ? "block h-2 rounded-full bg-success" : "block h-2 rounded-full bg-accent"}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="shrink-0 text-xs font-bold tabular-nums">{pct}%</span>
      </div>

      <p className="mt-2 text-xs text-muted">
        This month: {inflowMarker(monthlyNet)}
        <span data-money>{formatCurrency(monthlyNet)}</span> saved.{" "}
        {remainingAmount > 0
          ? <><span data-money>{formatCurrency(remainingAmount)}</span> remaining{paceSuffix}.</>
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
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      {footer}
    </li>
  );
}

export default function GoalsManager({
  initialGoals,
  monthlyNet,
  householdId = null,
}: Readonly<{
  initialGoals: Goal[];
  monthlyNet: number;
  /** When set, goals can be shared with this household (4.2-lite). */
  householdId?: string | null;
}>) {
  const supabase = createClient();
  const [addedGoals, setAddedGoals] = useState<Goal[]>([]);
  const [updatedGoals, setUpdatedGoals] = useState<Record<string, Partial<Goal>>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  const goals: Goal[] = [
    ...initialGoals
      .filter((g) => !deletedIds.has(g.id))
      .map((g) => (updatedGoals[g.id] ? { ...g, ...updatedGoals[g.id] } : g)),
    ...addedGoals.filter((g) => !deletedIds.has(g.id)),
  ];

  async function toggleShare(id: string, share: boolean) {
    const nextValue = share ? householdId : null;
    const { error: shareError } = await supabase
      .from("goals")
      .update({ household_id: nextValue })
      .eq("id", id);
    if (shareError) return;
    setUpdatedGoals((prev) => ({
      ...prev,
      [id]: { ...prev[id], household_id: nextValue },
    }));
  }
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  // Rollback helper for optimistic goal updates
  function restoreGoals(_snapshot: Goal[], message: string) {
    setError(message);
  }

  async function add(e: React.SyntheticEvent) {
    e.preventDefault();
    if (addBusy) return;
    setError(null);
    const parsedTarget = Number(target);
    if (!name.trim() || !Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError("Enter a name and a target amount greater than zero.");
      return;
    }
    setAddBusy(true);
    try {
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
      setAddedGoals((g) => [...g, data as Goal]);
      setName("");
      setTarget("");
      setTargetDate("");
    } finally {
      setAddBusy(false);
    }
  }

  async function contribute(id: string, amount: number) {
    const goal = goals.find((g) => g.id === id);
    if (!goal) return;
    const prevSaved = goal.saved_amount;
    const newTotal = Math.round((prevSaved + amount) * 100) / 100;
    setUpdatedGoals((prev) => ({
      ...prev,
      [id]: { ...prev[id], saved_amount: newTotal },
    }));
    const { error: updateError } = await supabase
      .from("goals")
      .update({ saved_amount: newTotal })
      .eq("id", id);
    if (updateError) {
      setUpdatedGoals((prev) => ({
        ...prev,
        [id]: { ...prev[id], saved_amount: prevSaved },
      }));
      restoreGoals([], updateError.message);
    }
  }

  async function updateGoal(id: string, draft: GoalDraft): Promise<boolean> {
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
    const currentGoal = goals.find((g) => g.id === id);
    const prevDraft: Partial<Goal> = currentGoal
      ? {
          name: currentGoal.name,
          target_amount: currentGoal.target_amount,
          saved_amount: currentGoal.saved_amount,
          target_date: currentGoal.target_date,
        }
      : {};
    const nextGoal: Partial<Goal> = {
      name: draft.name.trim(),
      target_amount: Math.round(parsedTarget * 100) / 100,
      saved_amount: Math.round(parsedSaved * 100) / 100,
      target_date: draft.targetDate || null,
    };
    setUpdatedGoals((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...nextGoal },
    }));
    const { error: updateError } = await supabase.from("goals").update(nextGoal).eq("id", id);
    if (updateError) {
      setUpdatedGoals((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...prevDraft },
      }));
      setError(updateError.message);
      return false;
    }
    return true;
  }

  async function remove(id: string) {
    setDeletedIds((prev) => new Set([...prev, id]));
    const { error: deleteError } = await supabase.from("goals").delete().eq("id", id);
    if (deleteError) {
      setDeletedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setError(deleteError.message);
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
              footer={
                householdId ? (
                  <label className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={Boolean(goal.household_id)}
                      onChange={(e) => toggleShare(goal.id, e.target.checked)}
                    />
                    <span>Visible to my household</span>
                  </label>
                ) : null
              }
            />
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-muted">No goals yet. Add your first savings target below.</p>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Goal name" htmlFor="goal-name">
          <Input
            id="goal-name"
            placeholder="Emergency fund"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Target amount" htmlFor="goal-target-amount">
          <Input
            id="goal-target-amount"
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
        <Button type="submit" size="md" loading={addBusy}>
          Add goal
        </Button>
      </form>

      <FormMessage message={error} />
    </Panel>
  );
}
