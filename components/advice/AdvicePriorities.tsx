"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

export interface AdviceTopicRef {
  id: string;
  title: string;
}

/**
 * Pin and reorder advice topics. Only the display order is saved; the
 * educational content contract is unchanged. Every change persists through the
 * authenticated shared advice route and is audited server-side.
 */
export default function AdvicePriorities({
  topics,
  initialPriorities,
}: Readonly<{
  topics: AdviceTopicRef[];
  initialPriorities: string[];
}>) {
  const [priorities, setPriorities] = useState<string[]>(initialPriorities);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/advice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "set_priorities", priorities: next }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? "Could not save priorities.");
      setPriorities(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save priorities.");
    } finally {
      setBusy(false);
    }
  }

  const titleOf = (id: string) => topics.find((topic) => topic.id === id)?.title ?? id;
  const unprioritized = topics.filter((topic) => !priorities.includes(topic.id));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= priorities.length) return;
    const currentItem = priorities.at(index);
    const targetItem = priorities.at(target);
    if (!currentItem || !targetItem) return;
    const next = priorities.map((id, currentIndex) => {
      if (currentIndex === index) return targetItem;
      if (currentIndex === target) return currentItem;
      return id;
    });
    void save(next);
  }

  function pin(id: string) {
    void save([id, ...priorities.filter((current) => current !== id)]);
  }

  function remove(id: string) {
    void save(priorities.filter((current) => current !== id));
  }

  return (
    <div className="min-w-0 rounded-field border border-panel-border bg-panel-2 p-3">
      <p className="mb-2 text-sm font-semibold">Your prioritized topics</p>
      {priorities.length === 0 && (
        <p className="mb-3 text-sm text-muted">Nothing prioritized yet. Pin a topic below to reorder it.</p>
      )}
      <ol className="space-y-2">
        {priorities.map((id, index) => (
          <li key={id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{titleOf(id)}</span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  move(index, -1);
                }}
                disabled={index === 0 || busy}
                aria-label={`Move ${titleOf(id)} up`}
                className="rounded-field px-2 py-1 text-xs text-muted hover:bg-panel-hover disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => {
                  move(index, 1);
                }}
                disabled={index === priorities.length - 1 || busy}
                aria-label={`Move ${titleOf(id)} down`}
                className="rounded-field px-2 py-1 text-xs text-muted hover:bg-panel-hover disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  remove(id);
                }}
                disabled={busy}
                aria-label={`Remove ${titleOf(id)} from prioritized`}
                className="rounded-field px-2 py-1 text-xs text-muted hover:text-danger"
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>

      {unprioritized.length > 0 && (
        <div className="mt-4 border-t border-panel-border pt-3">
          <p className="mb-2 text-sm font-semibold">Pin a topic</p>
          <ul className="space-y-1">
            {unprioritized.map((topic) => (
              <li key={topic.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{topic.title}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    pin(topic.id);
                  }}
                  disabled={busy}
                >
                  Prioritize
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
