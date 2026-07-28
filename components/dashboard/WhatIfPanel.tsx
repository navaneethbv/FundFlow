"use client";

import { useMemo, useState } from "react";
import { buildPayoffPlan } from "@/lib/debt";
import { computeRunwayMonths } from "@/lib/insights";
import { formatCurrency } from "@/lib/format";

interface WhatIfDebt {
  name: string;
  balance: number;
  apr: number;
}

/**
 * What-if simulator: slide income/spending/extra-debt deltas and watch
 * runway, monthly surplus, and the debt-free date recompute live. Pure
 * client-side math over lib/insights + lib/debt — no requests, no writes.
 */
export default function WhatIfPanel({
  cashBalance,
  monthlyIncome,
  monthlySpend,
  monthlyEssentials,
  debts,
}: {
  cashBalance: number | null;
  monthlyIncome: number;
  monthlySpend: number;
  monthlyEssentials: number[];
  debts: WhatIfDebt[];
}) {
  const [incomeDelta, setIncomeDelta] = useState(0);
  const [spendDelta, setSpendDelta] = useState(0);
  const [extraDebt, setExtraDebt] = useState(0);

  const projection = useMemo(() => {
    const surplus =
      monthlyIncome + incomeDelta - (monthlySpend + spendDelta);

    const adjustedEssentials = monthlyEssentials.map((amount) =>
      Math.max(0, amount + spendDelta),
    );
    const runwayMonths =
      adjustedEssentials.length > 0
        ? computeRunwayMonths({
            liquidBalance: cashBalance,
            monthlyEssentials: adjustedEssentials,
          })
        : null;

    const plan =
      debts.length > 0
        ? buildPayoffPlan({ debts, extraMonthly: extraDebt, strategy: "avalanche" })
        : null;

    return { surplus, runwayMonths, plan };
  }, [cashBalance, monthlyIncome, monthlySpend, monthlyEssentials, debts, incomeDelta, spendDelta, extraDebt]);

  const signed = (value: number) =>
    `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}/mo`;

  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      <h3 className="eyebrow">What if…</h3>
      <p className="mt-1 text-xs text-muted">
        Drag to simulate a change. Nothing is saved — this is a sandbox.
      </p>

      <div className="mt-4 space-y-4">
        <label className="block text-sm">
          <span className="flex justify-between font-semibold">
            <span>Income change</span>
            <span className="metric-value text-xs">{signed(incomeDelta)}</span>
          </span>
          <input
            type="range"
            min={-1000}
            max={2000}
            step={50}
            value={incomeDelta}
            onChange={(e) => setIncomeDelta(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>

        <label className="block text-sm">
          <span className="flex justify-between font-semibold">
            <span>Spending change</span>
            <span className="metric-value text-xs">{signed(spendDelta)}</span>
          </span>
          <input
            type="range"
            min={-2000}
            max={1000}
            step={50}
            value={spendDelta}
            onChange={(e) => setSpendDelta(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>

        {debts.length > 0 && (
          <label className="block text-sm">
            <span className="flex justify-between font-semibold">
              <span>Extra toward debt</span>
              <span className="metric-value text-xs">
                {formatCurrency(extraDebt)}/mo
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              step={25}
              value={extraDebt}
              onChange={(e) => setExtraDebt(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
        )}
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-field border border-panel-border bg-panel-2 p-3">
          <dt className="text-xs text-muted">Monthly surplus</dt>
          <dd
            className="metric-value mt-1 text-lg font-bold"
            style={{
              color:
                projection.surplus >= 0 ? "var(--viz-good)" : "var(--viz-bad)",
            }}
          >
            {projection.surplus >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(projection.surplus))}
          </dd>
        </div>
        <div className="rounded-field border border-panel-border bg-panel-2 p-3">
          <dt className="text-xs text-muted">Emergency runway</dt>
          <dd className="metric-value mt-1 text-lg font-bold">
            {projection.runwayMonths !== null
              ? `${projection.runwayMonths} mo`
              : "—"}
          </dd>
        </div>
        <div className="rounded-field border border-panel-border bg-panel-2 p-3">
          <dt className="text-xs text-muted">Debt-free</dt>
          <dd className="mt-1 text-sm">
            {debts.length === 0 ? (
              <span className="metric-value text-lg font-bold">—</span>
            ) : projection.plan ? (
              <>
                <span className="metric-value text-lg font-bold">
                  {projection.plan.months} mo
                </span>
                <span className="block text-xs text-muted">
                  {formatCurrency(projection.plan.totalInterest)} interest
                </span>
              </>
            ) : (
              <span className="text-xs text-warning">
                Payments don&apos;t cover the interest — add more.
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
