import { ADVICE_LIBRARY, type AdviceItem } from "./advice-content";

export interface AdviceView {
  prioritized: (AdviceItem & { done: number; total: number; started: boolean })[];
  essential: (AdviceItem & { done: number; total: number })[];
  completedCount: number;
}

export function buildAdviceView(
  library: AdviceItem[] = ADVICE_LIBRARY,
  progress: { advice_id: string; task_id: string }[] = [],
): AdviceView {
  const completedTaskSet = new Set<string>();
  for (const p of progress) {
    completedTaskSet.add(`${p.advice_id}::${p.task_id}`);
  }

  const prioritized = library.map((item) => {
    let done = 0;
    for (const t of item.tasks) {
      if (completedTaskSet.has(`${item.id}::${t.id}`)) {
        done += 1;
      }
    }
    return {
      ...item,
      done,
      total: item.tasks.length,
      started: done > 0,
    };
  });

  const completedCount = prioritized.filter((i) => i.done === i.total && i.total > 0).length;

  return {
    prioritized,
    essential: prioritized.filter((i) => i.done < i.total),
    completedCount,
  };
}
