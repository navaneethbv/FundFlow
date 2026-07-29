"use client";

import { useState } from "react";

export default function GoalWizard() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [goalType, setGoalType] = useState<"save_up" | "pay_down">("save_up");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !targetAmount) return;

    setLoading(true);
    try {
      await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          target_amount: parseFloat(targetAmount),
          target_date: targetDate || null,
          goal_type: goalType,
        }),
      });
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-field bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
      >
        + Create New Goal
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-panel border border-panel-border bg-panel p-6 space-y-4">
        <h3 className="text-lg font-bold text-foreground">Create Financial Goal</h3>
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-foreground mb-1">Goal Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Vacation Fund"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
            />
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1">Target Amount ($)</label>
            <input
              type="number"
              required
              placeholder="5000"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
            />
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1">Target Date (Optional)</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
            />
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1">Goal Type</label>
            <select
              value={goalType}
              onChange={(e) => setGoalType(e.target.value as "save_up" | "pay_down")}
              className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
            >
              <option value="save_up">Save Up (Savings Target)</option>
              <option value="pay_down">Pay Down (Debt Reduction)</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-3 py-1.5 font-semibold text-muted hover:bg-panel-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-accent px-3 py-1.5 font-semibold text-white hover:bg-accent/90"
            >
              Save Goal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
