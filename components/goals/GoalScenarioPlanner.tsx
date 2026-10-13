"use client";

import { useId, useState } from "react";
import Panel from "@/components/ui/Panel";
import Input, { fieldClasses } from "@/components/ui/Input";
import { formatCurrency } from "@/lib/format";
import { calculateGoalScenario, GOAL_SCENARIO_MAX_AMOUNT, type GoalCadence, type ScenarioGoal } from "@/lib/goal-scenarios";

type Props = { goals: ScenarioGoal[]; today: string };
const money = (amount: number) => <span data-money>{formatCurrency(amount, "USD")}</span>;

/** Remount when any server-loaded source changes; no scenario state leaves memory. */
export default function GoalScenarioPlanner(props: Readonly<Props>) {
  return <GoalSelection key={JSON.stringify(props)} {...props} />;
}
function GoalSelection({ goals, today }: Readonly<Props>) {
  const [selected, setSelected] = useState(goals[0]?.id ?? "");
  const id = useId();
  const goal = goals.find(item => item.id === selected);
  return <Panel title="Savings goal scenarios" eyebrow="What if · USD" className="mt-5">
    <p className="mb-4 text-sm text-muted">Explore contributions using your existing savings target. This preview stays on this page and does not change your goal. No investment return is assumed.</p>
    {!goal ? <p className="text-sm text-muted">Create a savings goal to explore contribution scenarios.</p> : <>
      <label className="block text-sm font-medium" htmlFor={id}>Savings goal</label>
      <select id={id} className={`${fieldClasses} mb-4 mt-1`} value={selected} onChange={event => { setSelected(event.target.value); }}>
        {goals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <GoalForm key={goal.id} goal={goal} today={today} />
    </>}
  </Panel>;
}
function GoalForm({ goal, today }: Readonly<{ goal: ScenarioGoal; today: string }>) {
  const id = useId();
  const [contribution, setContribution] = useState("0");
  const [lumpSum, setLumpSum] = useState("0");
  const [skip, setSkip] = useState("0");
  const [cadence, setCadence] = useState<GoalCadence>("monthly");
  const [deadline, setDeadline] = useState(goal.targetDate ?? "");
  let result: ReturnType<typeof calculateGoalScenario> | null = null;
  let error = "";
  try {
    if ([contribution, lumpSum, skip].some(value => !value.trim())) throw new Error("Enter a value in each amount and skipped-contributions field.");
    result = calculateGoalScenario({ targetAmount: goal.targetAmount, fundedAmount: goal.fundedAmount, contributionAmount: Number(contribution), lumpSum: Number(lumpSum), cadence, skipPayments: Number(skip), today, deadline: deadline || null });
  } catch (error_) { error = error_ instanceof Error ? error_.message : "Check your scenario inputs."; }
  const reset = () => { setContribution("0"); setLumpSum("0"); setSkip("0"); setCadence("monthly"); setDeadline(goal.targetDate ?? ""); };
  const amountFields = [
    { key: "contribution", label: "Contribution amount (USD)", value: contribution, set: setContribution, max: GOAL_SCENARIO_MAX_AMOUNT, step: "0.01" },
    { key: "lump", label: "Immediate lump sum (USD)", value: lumpSum, set: setLumpSum, max: GOAL_SCENARIO_MAX_AMOUNT, step: "0.01" },
    { key: "skip", label: "Skip first contributions", value: skip, set: setSkip, max: 120, step: "1" },
  ];
  return <div className="space-y-4">
    {result && <p className="text-sm">Target {money(goal.targetAmount)} · Funded {money(goal.fundedAmount)} · As of {today}</p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {amountFields.map(field => <div key={field.key} className="min-w-0">
        <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-${field.key}`}>{field.label}</label>
        <Input data-money id={`${id}-${field.key}`} type="number" inputMode="decimal" min={0} max={field.max} step={field.step} value={field.value} onChange={event => { field.set(event.target.value); }} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} autoComplete="off" />
      </div>)}
      <div className="min-w-0"><label className="mb-1 block text-sm font-medium" htmlFor={`${id}-cadence`}>Cadence</label>
        <select className={fieldClasses} id={`${id}-cadence`} value={cadence} onChange={event => { setCadence(event.target.value as GoalCadence); }}>
          <option value="weekly">Weekly</option><option value="biweekly">Biweekly (every 14 days)</option><option value="monthly">Monthly</option>
        </select>
      </div>
      <div className="min-w-0"><label className="mb-1 block text-sm font-medium" htmlFor={`${id}-deadline`}>Deadline</label>
        <Input className="min-w-0" id={`${id}-deadline`} type="date" max="9999-12-31" value={deadline} onChange={event => { setDeadline(event.target.value); }} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
      </div>
    </div>
    <button type="button" onClick={reset} className="min-h-11 rounded-field border border-panel-border px-4 py-2 text-sm font-medium hover:bg-panel-2 focus-visible:outline-2">Reset scenario</button>
    <p className="text-xs text-muted">The first scheduled contribution is one cadence after today. Monthly dates keep today’s day, clamped to month-end. Skips count within the 600-date limit.</p>
    {error && <p id={`${id}-error`} role="alert" className="text-sm text-danger">{error}</p>}
    {result && <GoalResults result={result} cadence={cadence} />}
  </div>;
}

type ScenarioResult = ReturnType<typeof calculateGoalScenario>;
function completionLabel(result: ScenarioResult) {
  if (result.completionDate) return result.completionDate;
  if (result.completionStatus === "no-contributions") return "No recurring contributions entered";
  return "Beyond the 600-date horizon";
}
function milestoneLabel(item: ScenarioResult["milestones"][number]) {
  if (item.status === "already-reached") return "Already reached";
  if (item.status === "lump-sum") return "Reached by lump sum today";
  return item.date ?? "Not reached within this scenario";
}
function deadlineMessage(status: string) {
  if (status === "past") return "This deadline is before today. Choose today or a future date.";
  if (status === "no-payments") return "No scheduled contributions fall on or before this deadline.";
  return "This deadline is beyond the 600-date horizon. Choose an earlier deadline.";
}
function DeadlineResult({ result, cadence }: Readonly<{ result: ScenarioResult["deadline"]; cadence: GoalCadence }>) {
  if (!result) return <p className="text-muted">Choose a deadline to calculate the required contribution.</p>;
  if (result.status !== "available") return <p>{deadlineMessage(result.status)}</p>;
  if (result.requiredAmount === null || result.gapAmount === null) return <p>Deadline amounts are unavailable.</p>;
  const cadenceLabel = new Map<GoalCadence, string>([["biweekly", "14 days"], ["weekly", "week"], ["monthly", "month"]]).get(cadence);
  return <>
    <p>{result.payments} scheduled contributions within this projection on or before the deadline.</p>
    <p>Required each {cadenceLabel}: {money(result.requiredAmount)}</p>
    <p>{result.gapAmount > 0 ? "Increase per contribution" : "Amount above required per contribution"}: {money(Math.abs(result.gapAmount))}</p>
  </>;
}
function GoalResults({ result, cadence }: Readonly<{ result: ScenarioResult; cadence: GoalCadence }>) {
  return <div aria-live="polite" className="space-y-4">
    <div className="rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
      <p>Projected completion: <strong>{completionLabel(result)}</strong></p>
      {result.completionStatus === "complete" && <p>The target is met with the current funded balance and applied lump sum.</p>}
      <p>Applied lump sum {money(result.appliedLumpSum)} · Remaining {money(result.remainingAmount)}</p>
      <p className="mt-1 text-xs text-muted">Projection capped at 600 future scheduled dates, through {result.horizonDate}.</p>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <caption className="mb-2 text-left font-semibold">Savings milestones</caption>
      <thead><tr><th className="py-2 pr-3" scope="col">Milestone</th><th className="py-2 pr-3" scope="col">Amount (USD)</th><th className="py-2" scope="col">Timing</th></tr></thead>
      <tbody>{result.milestones.map(item => <tr key={item.percent} className="border-t border-panel-border">
        <th className="py-2 pr-3 font-normal" scope="row">{item.percent}%</th><td className="py-2 pr-3">{money(item.amount)}</td>
        <td className="py-2">{milestoneLabel(item)}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="text-sm"><h3 className="font-semibold">Deadline contribution</h3><DeadlineResult result={result.deadline} cadence={cadence} /></div>
  </div>;
}
