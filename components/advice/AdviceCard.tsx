import TaskChecklist from "@/components/advice/TaskChecklist";
import Panel from "@/components/ui/Panel";
import type { AdviceItem } from "@/lib/advice-content";

const CATEGORY_LABELS: Record<AdviceItem["category"], string> = {
  save_up: "Save up",
  spend: "Spend",
  pay_down: "Pay down",
  protect: "Protect",
  invest: "Invest",
  wellness: "Wellness",
};

export default function AdviceCard({
  item,
  done,
  total,
  completedTaskIds,
}: Readonly<{
  item: AdviceItem;
  done: number;
  total: number;
  completedTaskIds: Set<string>;
}>) {
  return (
    <Panel padding="lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-accent">
            {CATEGORY_LABELS[item.category]}
          </span>
          <h3 className="mt-1 text-lg font-bold">{item.title}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-xs font-semibold text-muted">
          {done}/{total}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{item.body}</p>
      <div className="mt-4">
        <TaskChecklist adviceId={item.id} tasks={item.tasks} completedTaskIds={completedTaskIds} />
      </div>
      <div className="mt-4 space-y-1 border-t border-panel-border pt-3">
        {item.sources.map((source) => (
          <p key={source.url} className="text-xs text-muted">
            Source:{" "}
            <a href={source.url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              {source.title}
            </a>{" "}
            · reviewed {source.reviewedAt}
          </p>
        ))}
      </div>
    </Panel>
  );
}
