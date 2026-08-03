import TaskChecklist from "@/components/advice/TaskChecklist";
import { CreditCard, HeartPulse, PiggyBank, ShieldCheck, TrendingUp, Wallet } from "@/components/ui/icons";
import type { AdviceItem } from "@/lib/advice-content";

const CATEGORY_LABELS: Record<AdviceItem["category"], string> = {
  save_up: "Save up",
  spend: "Spend",
  pay_down: "Pay down",
  protect: "Protect",
  invest: "Invest",
  wellness: "Wellness",
};

const CATEGORY_ICON: Record<AdviceItem["category"], React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  save_up: PiggyBank,
  spend: Wallet,
  pay_down: CreditCard,
  protect: ShieldCheck,
  invest: TrendingUp,
  wellness: HeartPulse,
};

function statusMeta(done: number, total: number): string {
  const remaining = total - done;
  if (remaining <= 0) return "Completed";
  if (done === 0) return `Not started · ${total} task${total === 1 ? "" : "s"} to complete`;
  return `In progress · ${remaining} task${remaining === 1 ? "" : "s"} to complete`;
}

/**
 * A native `<details>` disclosure rather than a "use client" component with
 * `useState` — expand/collapse needs no JS at all here, matching the same
 * server-only-collapsible convention `AccountGroup`/`AccountPreferences` use.
 * Monarch navigates to a detail page for this; inline expansion is the
 * lighter adaptation carrying the same information (per the design doc).
 */
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
  const Icon = CATEGORY_ICON[item.category];

  return (
    <details className="overflow-hidden rounded-card border border-panel-border bg-panel shadow-card">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-5 focus-visible:outline-2">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
        >
          <Icon aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-accent">
            {CATEGORY_LABELS[item.category]}
          </span>
          <h3 className="mt-1 text-base font-bold">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{item.body}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {statusMeta(done, total)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-xs font-semibold text-muted">
          {done}/{total}
        </span>
      </summary>
      <div className="space-y-4 border-t border-panel-border px-5 pb-5 pt-4">
        <TaskChecklist adviceId={item.id} tasks={item.tasks} completedTaskIds={completedTaskIds} />
        <div className="space-y-1 border-t border-panel-border pt-3">
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
      </div>
    </details>
  );
}
