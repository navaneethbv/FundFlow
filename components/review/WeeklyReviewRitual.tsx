"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface Step {
  id: string;
  label: string;
  description: string;
  count: number | null;
  complete: boolean;
  href: string;
}

export default function WeeklyReviewRitual({
  steps,
  weekStart,
  initialStreak,
  initialCompleted,
}: Readonly<{
  steps: Step[];
  weekStart: string;
  initialStreak: number;
  initialCompleted: boolean;
}>) {
  const [checked, setChecked] = useState(() => new Set(steps.filter((step) => step.complete).map((step) => step.id)));
  const [completed, setCompleted] = useState(initialCompleted);
  const [streak, setStreak] = useState(initialStreak);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allChecked = checked.size === steps.length;
  const progress = useMemo(() => Math.round((checked.size / Math.max(1, steps.length)) * 100), [checked.size, steps.length]);

  function toggle(id: string): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function completeReview(): Promise<void> {
    if (!allChecked || completed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/review/weekly/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ complete: true }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; streak?: number } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not save your weekly review.");
      setCompleted(true);
      setStreak(Number(payload?.streak ?? streak));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your weekly review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Panel title="Weekly progress" eyebrow={`Week of ${weekStart}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{completed ? "This week is complete." : `${progress}% reviewed. Open each step, then mark it done.`}</p>
          <p className="text-sm font-semibold text-accent">{streak} week{streak === 1 ? "" : "s"} streak</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2" aria-label={`${progress}% complete`}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      </Panel>
      <ol className="space-y-3" aria-label="Weekly review steps">
        {steps.map((step, index) => {
          const isChecked = checked.has(step.id);
          return (
            <li key={step.id} className="rounded-card border border-panel-border bg-panel p-4 shadow-card">
              <div className="flex flex-wrap items-start gap-3">
                <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isChecked ? "bg-accent text-accent-foreground" : "bg-panel-2 text-muted"}`}>
                  {isChecked ? "✓" : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{step.label}</h2>
                  <p className="mt-1 text-sm text-muted">{step.description}</p>
                  {step.count !== null && step.count > 0 && <p className="mt-1 text-xs font-semibold text-warning">{step.count} item{step.count === 1 ? "" : "s"} to review</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={step.href} className="rounded-field border border-panel-border px-3 py-2 text-sm font-semibold text-accent hover:bg-accent-soft focus-visible:outline-2">Open</Link>
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={isChecked} onChange={() => { toggle(step.id); }} className="h-4 w-4 accent-accent" />
                    Done
                  </label>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <Panel>
        <Button type="button" onClick={() => void completeReview()} loading={busy} disabled={!allChecked || completed}>
          {completed ? "Weekly review complete" : "Complete weekly review"}
        </Button>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </Panel>
    </div>
  );
}
