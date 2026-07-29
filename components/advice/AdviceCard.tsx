"use client";

import { useState } from "react";
import type { AdviceItem } from "@/lib/advice-content";

export default function AdviceCard({
  item,
}: Readonly<{
  item: AdviceItem & { done: number; total: number };
}>) {
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(
    new Set(item.done > 0 ? item.tasks.slice(0, item.done).map((t) => t.id) : []),
  );

  const toggleTask = async (taskId: string) => {
    const next = new Set(completedTasks);
    const isDone = next.has(taskId);
    if (isDone) next.delete(taskId);
    else next.add(taskId);

    setCompletedTasks(next);

    try {
      await fetch("/api/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advice_id: item.id,
          task_id: taskId,
          completed: !isDone,
        }),
      });
    } catch {
      // ignore
    }
  };

  const doneCount = completedTasks.size;

  return (
    <div className="rounded-panel border border-panel-border bg-panel p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-semibold uppercase text-accent">
          {item.category.replace("_", " ")}
        </span>
        <span className="text-xs text-muted">
          {doneCount} of {item.total} completed
        </span>
      </div>

      <div>
        <h3 className="font-semibold text-foreground">{item.title}</h3>
        <p className="mt-1 text-xs text-muted leading-relaxed">{item.body}</p>
      </div>

      <div className="space-y-2 border-t border-panel-border pt-3">
        {item.tasks.map((t) => {
          const checked = completedTasks.has(t.id);
          return (
            <label key={t.id} className="flex items-start gap-2.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleTask(t.id)}
                className="mt-0.5 rounded border-panel-border text-accent focus:ring-accent"
              />
              <span className={checked ? "line-through text-muted" : "text-foreground"}>
                {t.label}
              </span>
            </label>
          );
        })}
      </div>

      {item.sources.length > 0 && (
        <div className="border-t border-panel-border pt-3 text-[0.65rem] text-muted">
          Source:{" "}
          <a
            href={item.sources[0].url}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            {item.sources[0].title}
          </a>
        </div>
      )}
    </div>
  );
}
