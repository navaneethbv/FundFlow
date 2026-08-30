"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { BudgetImportPlan } from "@/lib/budget-import";
import type {
  GoalImportDecision,
  GoalImportPlan,
  GoalImportPlanRow,
} from "@/lib/goal-import";

type ImportKind = "budget" | "goal";

export interface ConfigPlan {
  kind: ImportKind;
  plan: BudgetImportPlan | GoalImportPlan;
}

const GOAL_DECISION_LABELS: Record<GoalImportDecision, string> = {
  create: "Create",
  merge: "Merge",
  replace: "Replace",
  skip: "Skip",
};

export function defaultDecisionsForPlan(
  config: ConfigPlan,
): Record<string, string | undefined> {
  if (config.kind === "budget") {
    return Object.fromEntries(
      (config.plan as BudgetImportPlan).rows.map((row) => [row.category, "merge"]),
    );
  }
  return Object.fromEntries(
    (config.plan as GoalImportPlan).rows.map((row) => [
      row.decisionKey,
      row.defaultDecision,
    ]),
  );
}

export function goalDecisionOptions(
  row: GoalImportPlanRow,
): Array<{ value: GoalImportDecision; label: string }> {
  return row.allowedDecisions.map((value) => ({
    value,
    label: GOAL_DECISION_LABELS[value],
  }));
}

interface ApplyResult {
  ok: boolean;
  created?: number;
  updated?: number;
  skipped?: number;
  error?: string;
}

/**
 * Preview-and-apply Monarch configuration import (budgets and goals). Nothing
 * is written until the user picks a merge/skip (or create/merge/skip/replace)
 * decision and confirms; every change is audited server-side.
 */
export default function MonarchConfigImportSection() {
  const [kind, setKind] = useState<ImportKind>("budget");
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<ConfigPlan | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function preview() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/import/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text, mode: "preview" }),
      });
      const json = (await res.json().catch(() => null)) as (ConfigPlan & { error?: string }) | null;
      if (!res.ok) throw new Error(json?.error ?? "Could not preview.");
      if (!json) throw new Error("Could not preview.");
      setPlan(json);
      setDecisions(defaultDecisionsForPlan(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/import/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text, mode: "apply", decisions }),
      });
      const json = (await res.json().catch(() => null)) as ApplyResult | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Could not apply.");
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply.");
    } finally {
      setBusy(false);
    }
  }

  const budgetPlan = kind === "budget" ? (plan?.plan as BudgetImportPlan | undefined) : undefined;
  const goalPlan = kind === "goal" ? (plan?.plan as GoalImportPlan | undefined) : undefined;

  return (
    <Panel title="Import Monarch configuration" eyebrow="Budgets and goals">
      <p className="text-sm text-muted">
        Paste a Monarch budgets or goals export to preview it. Nothing is written until you
        choose how to handle each item; every change is audited. Existing contribution events
        and allocation caps are preserved.
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              checked={kind === "budget"}
              onChange={() => {
                setKind("budget");
              }}
            />
            <span>Budgets</span>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              checked={kind === "goal"}
              onChange={() => {
                setKind("goal");
              }}
            />
            <span>Goals</span>
          </label>
        </div>

        <textarea
          aria-label="Monarch configuration JSON"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder={'Paste the Monarch export here, e.g. { "groups": [...] } or { "goals": [...] }'}
          rows={6}
          className="w-full rounded-field border border-panel-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent/50"
        />

        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={preview} loading={busy} disabled={!text.trim()}>
            Preview
          </Button>
        </div>

        {plan && (
          <div className="rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
            {budgetPlan && (
              <>
                <p className="mb-2 font-semibold">
                  {budgetPlan.rows.length} budget categories
                  {budgetPlan.conflicts.length > 0 && ` · ${budgetPlan.conflicts.length} conflicts`}
                  {budgetPlan.unbudgetedCategories.length > 0 &&
                    ` · ${budgetPlan.unbudgetedCategories.length} unbudgeted in Monarch`}
                </p>
                <ul className="max-h-48 space-y-1 overflow-auto">
                  {budgetPlan.rows.map((row) => (
                    <li key={row.category} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{row.category}</span>
                      <span className="text-xs text-muted">{row.group}</span>
                      <select
                        aria-label={`Decision for ${row.category}`}
                        value={decisions[row.category] ?? "merge"}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDecisions((cur) => ({ ...cur, [row.category]: val }));
                        }}
                        className="rounded-field border border-panel-border bg-panel px-2 py-1 text-xs"
                      >
                        <option value="merge">Merge</option>
                        <option value="replace-month">Replace this month</option>
                        <option value="skip">Skip</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {goalPlan && (
              <>
                <p className="mb-2 font-semibold">
                  {goalPlan.rows.length} goals
                  {goalPlan.conflicts.length > 0 && ` · ${goalPlan.conflicts.length} conflicts`}
                </p>
                <ul className="max-h-48 space-y-1 overflow-auto">
                  {goalPlan.rows.map((row) => (
                    <li key={row.decisionKey} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{row.name}</span>
                      <span className="min-w-0 truncate text-xs text-muted">
                        {row.goalType}
                        {row.matchedGoalId && " · matches existing goal"}
                        {row.targetAmount !== null && ` · target ${formatCurrency(row.targetAmount)}`}
                        {row.targetDate && ` · due ${row.targetDate}`}
                        {row.linkedAccountName && ` · ${row.linkedAccountName}`}
                        {row.useEntireBalance && " · whole balance"}
                        {!row.useEntireBalance && row.allocationAmount !== null &&
                          ` · allocate ${formatCurrency(row.allocationAmount)}`}
                        {row.monthlyContribution !== null &&
                          ` · ${formatCurrency(row.monthlyContribution)}/month`}
                      </span>
                      <select
                        aria-label={`Decision for ${row.name}`}
                        value={decisions[row.decisionKey] ?? row.defaultDecision}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDecisions((cur) => ({
                            ...cur,
                            [row.decisionKey]: val,
                          }));
                        }}
                        className="rounded-field border border-panel-border bg-panel px-2 py-1 text-xs"
                      >
                        {goalDecisionOptions(row).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {plan.kind === "budget" && budgetPlan?.conflicts.length === 0 && (
              <p className="mt-2 text-xs text-muted">No category conflicts with your current budgets.</p>
            )}
            {plan.kind === "goal" && goalPlan?.conflicts.length === 0 && (
              <p className="mt-2 text-xs text-muted">No goal target conflicts with your current goals.</p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <output className="block text-sm text-success">
            Applied: {result.created ?? 0} created, {result.updated ?? 0} updated, {result.skipped ?? 0} skipped.
          </output>
        )}

        {plan && (
          <Button type="button" onClick={apply} loading={busy}>
            Apply configuration
          </Button>
        )}
      </div>
    </Panel>
  );
}
