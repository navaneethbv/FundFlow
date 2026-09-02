"use client";

import { useState } from "react";
import Link from "next/link";
import Panel from "@/components/ui/Panel";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";
import {
  totalAnnualPriceHikeImpact,
  type PriceSpikeAlert,
} from "@/lib/recurring-alerts";

export default function PriceSpikeBanner({
  initialAlerts,
}: Readonly<{
  initialAlerts: PriceSpikeAlert[];
}>) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || alerts.length === 0) return null;

  const totalImpact = totalAnnualPriceHikeImpact(alerts);

  function dismissItem(id: string) {
    setAlerts((cur) => cur.filter((a) => a.id !== id));
  }

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
              {alerts.length} recurring {alerts.length === 1 ? "service has" : "services have"} raised prices recently.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="danger">+{formatCurrency(totalImpact)}/yr</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDismissed(true);
            }}
            aria-label="Dismiss price increase alerts"
          >
            Dismiss all
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {alerts.map((alert) => (
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
                  dismissItem(alert.id);
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
