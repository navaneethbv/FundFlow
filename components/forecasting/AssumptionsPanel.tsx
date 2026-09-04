"use client";

import Link from "next/link";
import { useState } from "react";
import type { ForecastAssumptions, ForecastDefaults } from "@/lib/forecasting";
import Button from "@/components/ui/Button";
import LinkPendingIndicator from "@/components/ui/LinkPendingIndicator";

const HORIZONS: { value: ForecastAssumptions["horizonMonths"]; label: string }[] = [
  { value: 12, label: "1 year" },
  { value: 60, label: "5 years" },
  { value: 120, label: "10 years" },
];

function buildPresetUrl(
  assumptions: ForecastAssumptions,
  overrides: Partial<ForecastAssumptions>,
): string {
  const merged = { ...assumptions, ...overrides };
  const params = new URLSearchParams({
    monthlySavings: String(merged.monthlySavings),
    annualReturnPct: String(merged.annualReturnPct),
    annualCashYieldPct: String(merged.annualCashYieldPct),
    monthlyDebtPayment: String(merged.monthlyDebtPayment),
    horizon: String(merged.horizonMonths),
  });
  return `/forecasting?${params.toString()}`;
}

export default function AssumptionsPanel({
  assumptions,
  defaults,
}: Readonly<{ assumptions: ForecastAssumptions; defaults: ForecastDefaults }>) {
  const [pending, setPending] = useState(false);
  const presets = [
    {
      label: "Baseline",
      href: "/forecasting",
      isActive:
        assumptions.monthlySavings === defaults.monthlySavings &&
        assumptions.annualReturnPct === 5 &&
        assumptions.monthlyDebtPayment === defaults.monthlyDebtPayment,
    },
    {
      label: "Save +$200/mo",
      href: buildPresetUrl(assumptions, {
        monthlySavings: defaults.monthlySavings + 200,
      }),
      isActive: assumptions.monthlySavings === defaults.monthlySavings + 200,
    },
    {
      label: "Save +$500/mo",
      href: buildPresetUrl(assumptions, {
        monthlySavings: defaults.monthlySavings + 500,
      }),
      isActive: assumptions.monthlySavings === defaults.monthlySavings + 500,
    },
    {
      label: "Market Boom (8%)",
      href: buildPresetUrl(assumptions, { annualReturnPct: 8 }),
      isActive: assumptions.annualReturnPct === 8,
    },
    {
      label: "Conservative (4%)",
      href: buildPresetUrl(assumptions, { annualReturnPct: 4 }),
      isActive: assumptions.annualReturnPct === 4,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Scenario Presets
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={p.href}
              prefetch={false}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                p.isActive
                  ? "bg-accent-strong text-accent-strong-foreground shadow-sm"
                  : "border border-panel-border bg-panel text-muted hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {p.label}
              <LinkPendingIndicator />
            </Link>
          ))}
        </div>
      </div>

      <form
        method="get"
        action="/forecasting"
        aria-busy={pending || undefined}
        onSubmit={() => setPending(true)}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">
            Monthly savings {defaults.monthlySavings > 0 && "(from your last 6 months)"}
          </span>
          <input
            type="number"
            name="monthlySavings"
            defaultValue={assumptions.monthlySavings}
            className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
          />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">Annual investment return %</span>
          <input
            type="number"
            name="annualReturnPct"
            step="0.1"
            defaultValue={assumptions.annualReturnPct}
            className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
          />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">Annual cash yield %</span>
          <input
            type="number"
            name="annualCashYieldPct"
            step="0.1"
            defaultValue={assumptions.annualCashYieldPct}
            className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
          />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">
            Monthly debt payment {defaults.monthlyDebtPayment > 0 && "(from your last 6 months)"}
          </span>
          <input
            type="number"
            name="monthlyDebtPayment"
            defaultValue={assumptions.monthlyDebtPayment}
            className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
          />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">Horizon</span>
          <select
            name="horizon"
            defaultValue={assumptions.horizonMonths}
            className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
          >
            {HORIZONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2 lg:col-span-5">
          <Button
            type="submit"
            loading={pending}
          >
            Update projection
          </Button>
        </div>
      </form>
    </div>
  );
}
