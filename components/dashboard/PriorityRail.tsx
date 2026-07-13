import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatMinutesAgo } from "@/lib/format";

export type PriorityTone = "neutral" | "good" | "warning" | "danger";

export type PriorityInput = {
  brokenBankCount: number;
  isStale: boolean;
  lastSyncAgoMinutes: number | null;
  lowBalanceRisk: boolean;
  budgetRiskCount: number;
  anomalyCount: number;
};

export type PrioritySignal = {
  label: string;
  tone: PriorityTone;
  href?: string;
};

export function buildPrioritySignals({
  brokenBankCount,
  isStale,
  lastSyncAgoMinutes,
  lowBalanceRisk,
  budgetRiskCount,
  anomalyCount,
}: PriorityInput): PrioritySignal[] {
  return [
    brokenBankCount > 0
      ? {
          label: `${brokenBankCount} bank connection${brokenBankCount === 1 ? "" : "s"} need attention`,
          tone: "danger",
          href: "/settings",
        }
      : { label: "Banks healthy", tone: "neutral" },
    isStale
      ? { label: "Data needs a refresh", tone: "warning" }
      : {
          label: `Synced ${formatMinutesAgo(lastSyncAgoMinutes)}`,
          tone: "neutral",
        },
    lowBalanceRisk
      ? { label: "Low balance risk ahead", tone: "danger" }
      : { label: "Cash outlook stable", tone: "neutral" },
    budgetRiskCount > 0
      ? {
          label: `${budgetRiskCount} budget${budgetRiskCount === 1 ? "" : "s"} need attention`,
          tone: "warning",
          href: "/settings#budgets",
        }
      : { label: "Budgets on track", tone: "neutral" },
    anomalyCount > 0
      ? {
          label: `${anomalyCount} unusual activit${anomalyCount === 1 ? "y" : "ies"}`,
          tone: "warning",
          href: "/review",
        }
      : { label: "No unusual activity", tone: "neutral" },
  ];
}

const toneClasses: Record<PriorityTone, string> = {
  neutral: "bg-muted",
  good: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export default function PriorityRail(props: PriorityInput) {
  const signals = buildPrioritySignals(props);

  return (
    <section
      aria-label="Financial status"
      className="overflow-hidden rounded-card border border-panel-border bg-panel"
    >
      <div className="flex divide-x divide-panel-border overflow-x-auto scrollbar-none">
        {signals.map((signal) => {
          const content = (
            <>
              <span
                aria-hidden
                className={cn("h-2 w-2 shrink-0 rounded-full", toneClasses[signal.tone])}
              />
              <span className="whitespace-nowrap">{signal.label}</span>
            </>
          );

          return signal.href ? (
            <Link
              key={signal.label}
              href={signal.href}
              className="flex min-h-11 flex-1 items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-panel-hover focus-visible:outline-2"
            >
              {content}
            </Link>
          ) : (
            <div
              key={signal.label}
              className="flex min-h-11 flex-1 items-center gap-2 px-3 py-2 text-xs font-medium text-muted"
            >
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
