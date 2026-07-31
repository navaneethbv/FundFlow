"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdviceTask } from "@/lib/advice-content";

export default function TaskChecklist({
  adviceId,
  tasks,
  completedTaskIds,
}: Readonly<{ adviceId: string; tasks: AdviceTask[]; completedTaskIds: Set<string> }>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [completed, setCompleted] = useState(completedTaskIds);

  async function toggle(taskId: string, checked: boolean) {
    setPending(taskId);
    // Optimistic: flip immediately, roll back only if the request fails.
    setCompleted((prev) => {
      const next = new Set(prev);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
    try {
      const response = await fetch("/api/advice", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "toggle_task", adviceId, taskId, completed: checked }),
      });
      if (!response.ok) {
        setCompleted((prev) => {
          const next = new Set(prev);
          if (checked) next.delete(taskId);
          else next.add(taskId);
          return next;
        });
      } else {
        router.refresh();
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            id={`${adviceId}-${task.id}`}
            checked={completed.has(task.id)}
            disabled={pending === task.id}
            onChange={(e) => toggle(task.id, e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-panel-border"
          />
          <label
            htmlFor={`${adviceId}-${task.id}`}
            className={completed.has(task.id) ? "text-muted line-through" : ""}
          >
            {task.label}
          </label>
        </li>
      ))}
    </ul>
  );
}
