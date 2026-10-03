"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import { formatCurrency, titleCase } from "@/lib/format";
import type { BudgetSeedProposal } from "@/lib/budget-page";
import {
  SETUP_STEPS,
  buildSetupItems,
  initialSetupRows,
  rowsForStep,
  summarizeSetup,
  type SetupRow,
  type SetupStep,
} from "@/lib/budget-setup";

const STEP_COPY: Record<SetupStep, { title: string; help: string }> = {
  income: { title: "Income", help: "Confirm the income you expect each month." },
  fixed: { title: "Fixed costs", help: "Bills that stay about the same, like rent and subscriptions." },
  flexible: { title: "Flexible spending", help: "Day-to-day and occasional spending you can adjust." },
  review: { title: "Review", help: "Check the plan against your income before saving it." },
};

function StepRows({ rows, currency, onChange }: Readonly<{
  rows: SetupRow[];
  currency: string;
  onChange: (category: string, patch: Partial<SetupRow>) => void;
}>) {
  if (rows.length === 0) return <p className="text-sm text-muted">No suggestions for this step from recent history.</p>;
  return (
    <ul className="divide-y divide-panel-border">
      {rows.map((row) => {
        const id = `setup-${row.category}`;
        return (
          <li key={row.category} className="flex flex-wrap items-center gap-3 py-3">
            <input
              id={`${id}-include`}
              type="checkbox"
              checked={row.included}
              onChange={(event) => onChange(row.category, { included: event.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <label htmlFor={`${id}-include`} className="min-w-0 flex-1 text-sm font-semibold">
              {titleCase(row.category)}
              <span className="block text-xs font-normal text-muted">
                Suggested {formatCurrency(row.suggested_amount, currency)} · {row.reason}
              </span>
            </label>
            <label htmlFor={`${id}-amount`} className="sr-only">Monthly amount for {titleCase(row.category)}</label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              value={row.amountText}
              disabled={!row.included}
              onChange={(event) => onChange(row.category, { amountText: event.target.value })}
              className="w-32"
            />
          </li>
        );
      })}
    </ul>
  );
}

function ReviewSummary({ rows, currency }: Readonly<{ rows: SetupRow[]; currency: string }>) {
  const summary = summarizeSetup(rows);
  if (summary.status === "no_income") {
    return <p className="text-sm text-muted">No income is included, so this plan cannot be checked against what you earn.</p>;
  }
  return (
    <p className="text-sm">
      Planned spending <span data-money>{formatCurrency(summary.allocated, currency)}</span> against{" "}
      <span data-money>{formatCurrency(summary.expectedIncome, currency)}</span> of income.{" "}
      {summary.status === "over"
        ? <strong className="text-danger">This plan is <span data-money>{formatCurrency(summary.overBy, currency)}</span> over income.</strong>
        : "It fits within your income."}
    </p>
  );
}

/** Reference adoption 7.3: a guided first budget from trailing averages. */
export default function BudgetSetupWizard({
  proposals,
  month,
  currency,
}: Readonly<{ proposals: BudgetSeedProposal[]; month: string; currency: string }>) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [rows, setRows] = useState(() => initialSetupRows(proposals));
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = SETUP_STEPS[stepIndex]!;

  function update(category: string, patch: Partial<SetupRow>) {
    setRows((current) => current.map((row) => (row.category === category ? { ...row, ...patch } : row)));
  }

  function go(next: number) {
    setError(null);
    setStepIndex(next);
    // Keep keyboard and screen reader users oriented on the new step.
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  async function save() {
    const built = buildSetupItems(rows);
    if ("error" in built) return setError(built.error);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, items: built.items }),
      });
      if (!response.ok) throw new Error("budget_setup_failed");
      router.refresh();
    } catch {
      setError("The budget could not be saved. Review it and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (proposals.length === 0) return null;
  const copy = STEP_COPY[step];
  return (
    <Panel tone="accent" eyebrow={`Set up your budget · Step ${stepIndex + 1} of ${SETUP_STEPS.length}`}>
      <ol className="mb-4 flex flex-wrap gap-2 text-xs" aria-label="Budget setup steps">
        {SETUP_STEPS.map((name, index) => (
          <li key={name} aria-current={index === stepIndex ? "step" : undefined}
            className={index === stepIndex ? "font-semibold text-accent" : "text-muted"}>
            {index + 1}. {STEP_COPY[name].title}
          </li>
        ))}
      </ol>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-2">{copy.title}</h2>
      <p className="mb-3 text-sm text-muted">{copy.help}</p>
      <StepRows rows={rowsForStep(rows, step)} currency={currency} onChange={update} />
      {step === "review" && <div className="mt-3"><ReviewSummary rows={rows} currency={currency} /></div>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0}>Back</Button>
        {step === "review"
          ? <Button type="button" onClick={save} loading={saving}>Save budget</Button>
          : <Button type="button" onClick={() => go(stepIndex + 1)}>Next</Button>}
      </div>
    </Panel>
  );
}
