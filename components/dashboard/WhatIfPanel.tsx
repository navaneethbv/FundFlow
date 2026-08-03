"use client";

import { useMemo, useState } from "react";
import { computeWhatIfProjection } from "@/lib/forecasting";
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
}: Readonly<{
  cashBalance: number | null;
  monthlyIncome: number;
  monthlySpend: number;
  monthlyEssentials: number[];
  debts: WhatIfDebt[];
}>) {
  const [incomeDelta, setIncomeDelta] = useState(0);
  const [spendDelta, setSpendDelta] = useState(0);
  const [extraDebt, setExtraDebt] = useState(0);

  const projection = useMemo(
    () =>
      computeWhatIfProjection({
        cashBalance,
        monthlyIncome,
        monthlySpend,
        monthlyEssentials,
        debts,
        incomeDelta,
        spendDelta,
        extraDebt,
      }),
    [cashBalance, monthlyIncome, monthlySpend, monthlyEssentials, debts, incomeDelta, spendDelta, extraDebt],
  );

  const signed = (value: number) =>
    `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}/mo`;

  return (
    <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
      <h3 className="eyebrow">What if…</h3>
      <p className="mt-1 text-xs text-muted">
        Drag to simulate a change. Nothing is saved — this is a sandbox.
      </p>

      <div className="mt-4 space-y-4">
        <label className="block text-sm" htmlFor="whatif-income">
          <span className="flex justify-between font-semibold">
            <span>Income change</span>
            <span className="metric-value text-xs">{signed(incomeDelta)}</span>
          </span>
          <input
            id="whatif-income"
            type="range"
            min={-1000}
            max={2000}
            step={50}
            value={incomeDelta}
            onChange={(e) => setIncomeDelta(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>

        <label className="block text-sm" htmlFor="whatif-spend">
          <span className="flex justify-between font-semibold">
            <span>Spending change</span>
            <span className="metric-value text-xs">{signed(spendDelta)}</span>
          </span>
          <input
            id="whatif-spend"
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
          <label className="block text-sm" htmlFor="whatif-debt">
            <span className="flex justify-between font-semibold">
              <span>Extra toward debt</span>
              <span className="metric-value text-xs">
                {formatCurrency(extraDebt)}/mo
              </span>
            </span>
            <input
              id="whatif-debt"
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
            data-money
            className={`metric-value mt-1 text-lg font-bold ${projection.surplus >= 0 ? "text-success" : "text-danger"}`}
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
            {debts.length === 0 && (
              <span className="metric-value text-lg font-bold">—</span>
            )}
            {debts.length > 0 && projection.plan && (
              <>
                <span className="metric-value text-lg font-bold">
                  {projection.plan.months} mo
                </span>
                <span data-money className="block text-xs text-muted">
                  {formatCurrency(projection.plan.totalInterest)} interest
                </span>
              </>
            )}
            {debts.length > 0 && !projection.plan && (
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
