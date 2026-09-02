"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Panel from "@/components/ui/Panel";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";
import {
  totalAnnualPriceHikeImpact,
  type PriceSpikeAlert,
} from "@/lib/recurring-alerts";

const DISMISSED_STORAGE_KEY = "fundflow.price-spike-dismissed-ids";

// Subscribes to nothing: used purely so useSyncExternalStore flips `hydrated`
// after mount, matching the SidebarShell/MobileNavigation idiom for state that
// must stay identical between server render and first client render.
const subscribeToHydration = () => () => undefined;

const EMPTY_DISMISSED: ReadonlySet<string> = new Set();

function readDismissedIds(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function persistDismissedIds(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode, quota): dismissal stays session-only.
  }
}

export default function PriceSpikeBanner({
  initialAlerts,
}: Readonly<{
  initialAlerts: PriceSpikeAlert[];
}>) {
  const [sessionDismissed, setSessionDismissed] = useState<ReadonlySet<string>>(new Set());
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  // Dismissals persist across reloads. Stored ids only apply after hydration
  // so the server and first client render agree on which alerts are visible.
  const dismissedIds: ReadonlySet<string> = hydrated
    ? new Set([...readDismissedIds(), ...sessionDismissed])
    : EMPTY_DISMISSED;

  const visibleAlerts = initialAlerts.filter((a) => !dismissedIds.has(a.id));

  function dismiss(ids: readonly string[]) {
    if (ids.length === 0) return;
    const next = new Set(sessionDismissed);
    for (const id of ids) next.add(id);
    persistDismissedIds([...next, ...(hydrated ? readDismissedIds() : [])]);
    setSessionDismissed(next);
  }

  if (visibleAlerts.length === 0) return null;

  const totalImpact = totalAnnualPriceHikeImpact(visibleAlerts);

  return (
    <Panel
      tone="warning"
      className="border-warning/30 bg-warning-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-border/50 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-warning/20 text-xs font-bold text-warning">
            ↑
          </span>
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Subscription price increases detected
            </h3>
            <p className="text-xs text-muted">
              {visibleAlerts.length} recurring {visibleAlerts.length === 1 ? "service has" : "services have"} raised prices recently.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="danger">+{formatCurrency(totalImpact)}/yr</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dismiss(visibleAlerts.map((a) => a.id));
            }}
            aria-label="Dismiss price increase alerts"
          >
            Dismiss all
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {visibleAlerts.map((alert) => (
          <div
            key={alert.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-panel p-2.5 text-xs shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                <span className="truncate">{alert.merchantName}</span>
                <Badge tone="neutral">{alert.frequency}</Badge>
              </div>
              <div className="mt-0.5 text-muted">
                <span className="line-through">{formatCurrency(alert.previousAmount)}</span>
                {" → "}
                <span className="font-bold text-danger">
                  {formatCurrency(alert.currentAmount)}
                </span>
                <span className="ml-1 text-[11px] font-semibold text-warning">
                  (+{alert.percentIncrease}%)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-muted">
                +{formatCurrency(alert.annualizedImpact)}/yr
              </span>
              <Link
                href={`/transactions?search=${encodeURIComponent(alert.merchantName)}`}
                className="text-accent hover:underline font-medium"
              >
                View history
              </Link>
              <button
                type="button"
                onClick={() => {
                  dismiss([alert.id]);
                }}
                aria-label={`Dismiss alert for ${alert.merchantName}`}
                className="text-muted hover:text-foreground text-sm"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
