import Link from "next/link";
import { cn } from "@/lib/cn";
import { ChevronRight } from "@/components/ui/icons";
import { formatMinutesAgo } from "@/lib/format";

export type PriorityTone = "neutral" | "good" | "warning" | "danger";

export type PriorityInput = {
  brokenBankCount: number;
  isStale: boolean;
  lastSyncAgoMinutes: number | null;
  lowBalanceRisk: boolean;
  budgetCount: number;
  budgetRiskCount: number;
  anomalyCount: number;
};

/**
 * Every signal carries an `href`. The rail is a row of five chips that look
 * alike, so a chip without a destination reads as clickable and does nothing —
 * and the states a user reaches for first (stale data, low balance) are the
 * ones that most need somewhere to go.
 */
export type PrioritySignal = {
  label: string;
  tone: PriorityTone;
  href: string;
};

const BUDGETS_HREF = "/settings?section=categories";
/** Bank freshness is managed per-institution, so both sync signals land there. */
const INSTITUTIONS_HREF = "/settings?section=institutions";
const CASH_FLOW_HREF = "/cash-flow";

function buildBudgetSignal(budgetCount: number, budgetRiskCount: number): PrioritySignal {
  if (budgetCount === 0) {
    return { label: "Budgets not set", tone: "neutral", href: BUDGETS_HREF };
  }
  if (budgetRiskCount > 0) {
    return {
      label: `${budgetRiskCount} budget${budgetRiskCount === 1 ? "" : "s"} need attention`,
      tone: "warning",
      href: BUDGETS_HREF,
    };
  }
  return { label: "Budgets on track", tone: "neutral", href: BUDGETS_HREF };
}

export function buildPrioritySignals({
  brokenBankCount,
  isStale,
  lastSyncAgoMinutes,
  lowBalanceRisk,
  budgetCount,
  budgetRiskCount,
  anomalyCount,
}: PriorityInput): PrioritySignal[] {
  const budgetSignal = buildBudgetSignal(budgetCount, budgetRiskCount);
  return [
    brokenBankCount > 0
      ? {
          label: `${brokenBankCount} bank connection${brokenBankCount === 1 ? "" : "s"} need attention`,
          tone: "danger",
          href: "/settings",
        }
      : { label: "Banks healthy", tone: "neutral", href: INSTITUTIONS_HREF },
    isStale
      ? { label: "Data needs a refresh", tone: "warning", href: INSTITUTIONS_HREF }
      : {
          label: `Synced ${formatMinutesAgo(lastSyncAgoMinutes)}`,
          tone: "neutral",
          href: INSTITUTIONS_HREF,
        },
    lowBalanceRisk
      ? { label: "Low balance risk ahead", tone: "danger", href: CASH_FLOW_HREF }
      : { label: "Cash outlook stable", tone: "neutral", href: CASH_FLOW_HREF },
    budgetSignal,
    anomalyCount > 0
      ? {
          label: `${anomalyCount} unusual activit${anomalyCount === 1 ? "y" : "ies"}`,
          tone: "warning",
          href: "/review",
        }
      : { label: "No unusual activity", tone: "neutral", href: "/review" },
  ];
}

const toneClasses: Record<PriorityTone, string> = {
  neutral: "bg-muted",
  good: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export default function PriorityRail(props: Readonly<PriorityInput>) {
  const signals = buildPrioritySignals(props);

  return (
    <section
      aria-label="Financial status"
      className="overflow-hidden rounded-card border border-panel-border bg-panel"
    >
      <div className="grid grid-cols-1 gap-px bg-panel-border sm:grid-cols-2 xl:grid-cols-5">
        {signals.map((signal) => (
          <Link
            key={signal.label}
            href={signal.href}
            className="group flex min-h-11 items-center gap-2 bg-panel px-3 py-2 text-xs font-semibold leading-4 text-foreground transition-colors hover:bg-panel-hover focus-visible:outline-2"
          >
            <span
              aria-hidden
              className={cn("h-2 w-2 shrink-0 rounded-full", toneClasses[signal.tone])}
            />
            <span className="min-w-0 flex-1 truncate">{signal.label}</span>
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
