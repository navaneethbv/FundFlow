"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import type { FundedGoal } from "@/lib/goals-v2";

type Mode = "menu" | "edit" | "contribute";

/**
 * The v2 goal card's `⋯` menu — Edit, Add contribution, household
 * visibility, and Delete, replacing the legacy `GoalsManager` panel's flat
 * list for these same actions (single source of truth is now the card).
 * Same bespoke popover chrome as Budget's `RowMenu`/Recurring's
 * `OccurrenceRowMenu`: real form controls, not link/action rows, so it
 * isn't built on the shared `DropdownButton`.
 *
 * "Add contribution" only appears for save-up goals: a pay-down goal's
 * funded amount is the linked liability's balance delta alone
 * (`lib/goals-v2.ts`'s `computeFundedGoals`) — a manual event there would
 * either double-count or, since pay-down math never adds `eventTotal`,
 * silently do nothing. Editing always exposes the payoff amount
 * (`target_amount`) for a pay-down goal, matching `goalTargetAmount`'s math;
 * `target_balance` is derived from it against the captured `starting_balance`.
 * `starting_balance` is never editable here — it is a captured baseline the
 * `set_goal_allocation` database function sets once, by design.
 */
export default function GoalCardMenu({
  goal,
  householdId,
}: Readonly<{
  goal: FundedGoal;
  /** When set, the goal can be shared with this household (4.2-lite). */
  householdId?: string | null;
}>) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [name, setName] = useState(goal.name);
  const [targetAmount, setTargetAmount] = useState(
    String(goal.target_amount),
  );
  const [targetDate, setTargetDate] = useState(goal.target_date ?? "");
  const [contribution, setContribution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    setMode("menu");
    setError(null);
  }

  async function saveEdit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    // A positive target, matching GoalWizard's creation rule. `Number("")` is
    // 0, so a "zero or more" check let a cleared field write `target_amount:
    // 0` — which `goalTargetAmount` reads as an already-met target, rendering
    // an untouched goal 100% complete and firing "Goal reached".
    const parsedTarget = Number(targetAmount.trim());
    if (!name.trim() || !Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError("Enter a name and a target greater than zero.");
      return;
    }
    setBusy(true);
    // Keep `target_balance` mirroring the payoff amount against the captured
    // baseline, so any reader of that column stays consistent with
    // `goalTargetAmount`. Without a baseline it stays untouched.
    const patch =
      goal.goal_type === "pay_down"
        ? {
            name: name.trim(),
            target_amount: Math.round(parsedTarget * 100) / 100,
            target_balance:
              goal.starting_balance !== null
                ? Math.max(
                    0,
                    Math.round((goal.starting_balance - parsedTarget) * 100) /
                      100,
                  )
                : goal.target_balance,
            target_date: targetDate || null,
          }
        : {
            name: name.trim(),
            target_amount: Math.round(parsedTarget * 100) / 100,
            target_date: targetDate || null,
          };
    const { error: updateError } = await supabase.from("goals").update(patch).eq("id", goal.id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    close();
    router.refresh();
  }

  async function submitContribution(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const parsed = Number(contribution);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/goals/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: goal.id, amount: parsed, eventType: "manual_contribution" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That contribution could not be saved.");
        return;
      }
      setContribution("");
      close();
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHousehold(share: boolean) {
    setBusy(true);
    const { error: updateError } = await supabase
      .from("goals")
      .update({ household_id: share ? householdId : null })
      .eq("id", goal.id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const { error: deleteError } = await supabase.from("goals").delete().eq("id", goal.id);
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    close();
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      {open && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={close}
          className="fixed inset-0 z-30 cursor-default"
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More options for ${goal.name}`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
      >
        <span aria-hidden className="text-lg leading-none">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Options for ${goal.name}`}
          className="absolute right-0 z-40 mt-2 w-72 space-y-3 rounded-card border border-panel-border bg-panel p-3 shadow-float"
        >
          {mode === "menu" && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="flex min-h-11 w-full items-center rounded-field px-2.5 text-left text-sm font-medium hover:bg-panel-hover"
              >
                Edit goal
              </button>
              {goal.goal_type === "save_up" && (
                <button
                  type="button"
                  onClick={() => setMode("contribute")}
                  className="flex min-h-11 w-full items-center rounded-field px-2.5 text-left text-sm font-medium hover:bg-panel-hover"
                >
                  Add contribution
                </button>
              )}
              {householdId && (
                <label className="flex min-h-11 items-center gap-2 rounded-field px-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(goal.household_id)}
                    disabled={busy}
                    onChange={(event) => toggleHousehold(event.target.checked)}
                  />
                  {" "}Visible to my household
                </label>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="flex min-h-11 w-full items-center rounded-field px-2.5 text-left text-sm font-medium text-danger hover:bg-panel-hover"
              >
                Delete goal
              </button>
            </div>
          )}

          {mode === "edit" && (
            <form onSubmit={saveEdit} className="space-y-3">
              <label className="block text-xs font-semibold text-muted">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-2 text-sm text-foreground"
                />
              </label>
              <label className="block text-xs font-semibold text-muted">
                <span>{goal.goal_type === "pay_down" ? "Amount to pay down" : "Target amount"}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={targetAmount}
                  onChange={(event) => setTargetAmount(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-2 text-right text-sm text-foreground"
                />
              </label>
              <label className="block text-xs font-semibold text-muted">
                Target date{" "}
                <input
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-2 text-sm text-foreground"
                />
              </label>
              {error && <p className="text-xs font-semibold text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy}>
                  Save changes
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode("menu")}>
                  Back
                </Button>
              </div>
            </form>
          )}

          {mode === "contribute" && (
            <form onSubmit={submitContribution} className="space-y-3">
              <label className="block text-xs font-semibold text-muted">
                Contribution amount{" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={contribution}
                  onChange={(event) => setContribution(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-2 text-right text-sm text-foreground"
                />
              </label>
              {error && <p className="text-xs font-semibold text-danger">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy}>
                  Add
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode("menu")}>
                  Back
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
