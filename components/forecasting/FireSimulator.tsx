"use client";

import { useState, useMemo } from "react";
import Panel from "@/components/ui/Panel";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import ProgressBar from "@/components/ui/ProgressBar";
import { formatCurrency } from "@/lib/format";
import {
  calculateFireSimulation,
  type LifeEvent,
  type FireSimulatorInput,
} from "@/lib/fire-simulator";

interface FireSimulatorProps {
  initialNetWorth: number;
  initialMonthlyIncome: number;
  initialMonthlySpend: number;
  initialMonthlySavings: number;
}

const DEFAULT_EVENTS: LifeEvent[] = [
  { id: "e1", name: "Home Purchase Down Payment", monthOffset: 24, oneTimeCashFlow: -60000 },
  { id: "e2", name: "Career Promotion / Raise", monthOffset: 36, oneTimeCashFlow: 0, ongoingMonthlySpendDelta: -500 },
];

export default function FireSimulator({
  initialNetWorth,
  initialMonthlyIncome,
  initialMonthlySpend,
  initialMonthlySavings,
}: Readonly<FireSimulatorProps>) {
  const [currentAge, setCurrentAge] = useState(32);
  const [withdrawalRate, setWithdrawalRate] = useState(4.0);
  const [annualReturn, setAnnualReturn] = useState(7.0);
  const [monthlySavings, setMonthlySavings] = useState(initialMonthlySavings > 0 ? initialMonthlySavings : 1500);
  const [monthlySpend, setMonthlySpend] = useState(initialMonthlySpend > 0 ? initialMonthlySpend : 4000);
  const [events, setEvents] = useState<LifeEvent[]>(DEFAULT_EVENTS);

  // New event form state
  const [newEventName, setNewEventName] = useState("");
  const [newEventMonth, setNewEventMonth] = useState(12);
  const [newEventCashFlow, setNewEventCashFlow] = useState(-20000);

  const simulation = useMemo(() => {
    const input: FireSimulatorInput = {
      currentNetWorth: initialNetWorth,
      monthlyIncome: initialMonthlyIncome,
      monthlySpend,
      monthlySavings,
      annualReturnPct: annualReturn,
      withdrawalRatePct: withdrawalRate,
      currentAge,
      lifeEvents: events,
      projectionHorizonMonths: 300, // 25 years
    };
    return calculateFireSimulation(input);
  }, [
    initialNetWorth,
    initialMonthlyIncome,
    monthlySpend,
    monthlySavings,
    annualReturn,
    withdrawalRate,
    currentAge,
    events,
  ]);

  function addEvent(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!newEventName.trim()) return;
    const ev: LifeEvent = {
      id: crypto.randomUUID(),
      name: newEventName.trim(),
      monthOffset: Number(newEventMonth) || 12,
      oneTimeCashFlow: Number(newEventCashFlow) || 0,
    };
    setEvents((cur) => [...cur, ev]);
    setNewEventName("");
  }

  function removeEvent(id: string) {
    setEvents((cur) => cur.filter((ev) => ev.id !== id));
  }

  return (
    <Panel title="FIRE & life-event simulator" eyebrow="Financial Independence">
      <div className="space-y-6">
        {/* Milestone Cards Grid */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-card border border-panel-border bg-panel-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Lean FIRE (75%)
              </span>
              <Badge tone="neutral">Basic</Badge>
            </div>
            <div className="mt-2 text-xl font-bold font-mono">
              {formatCurrency(simulation.milestones.leanFireTarget)}
            </div>
            <p className="mt-1 text-xs text-muted">Essential expenses covered</p>
          </div>

          <div className="rounded-card border border-accent/40 bg-accent-soft/30 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                Standard FIRE (100%)
              </span>
              <Badge tone="accent">25x Spend</Badge>
            </div>
            <div className="mt-2 text-xl font-bold text-accent font-mono">
              {formatCurrency(simulation.milestones.standardFireTarget)}
            </div>
            <p className="mt-1 text-xs text-muted">
              {simulation.projectedFireAge
                ? `Projected at Age ${simulation.projectedFireAge} (~${Math.round((simulation.monthsToStandardFire ?? 0) / 12)} yrs)`
                : "Increase savings rate to reach target"}
            </p>
          </div>

          <div className="rounded-card border border-panel-border bg-panel-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Fat FIRE (150%)
              </span>
              <Badge tone="success">Abundant</Badge>
            </div>
            <div className="mt-2 text-xl font-bold font-mono">
              {formatCurrency(simulation.milestones.fatFireTarget)}
            </div>
            <p className="mt-1 text-xs text-muted">High discretionary lifestyle</p>
          </div>
        </div>

        {/* Current Progress Gauge */}
        <div className="rounded-field bg-panel-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Current FIRE progress</span>
            <span className="font-bold text-accent">{simulation.currentProgressPct}%</span>
          </div>
          <div className="mt-2">
            <ProgressBar percent={simulation.currentProgressPct} tone="accent" ariaLabel="FIRE progress" />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>Net Worth: {formatCurrency(initialNetWorth)}</span>
            <span>Savings Rate: {simulation.savingsRatePct}%</span>
            <span>Coast FIRE Target: {formatCurrency(simulation.milestones.coastFireTarget)}</span>
          </div>
        </div>

        {/* Interactive Assumption Controls */}
        <div className="grid gap-4 sm:grid-cols-5">
          <Field label="Current age" htmlFor="fire-age">
            <Input
              id="fire-age"
              type="number"
              value={currentAge}
              onChange={(e) => {
                setCurrentAge(Number(e.target.value) || 30);
              }}
              min={18}
              max={80}
            />
          </Field>
          <Field label="Monthly spend ($)" htmlFor="fire-spend">
            <Input
              id="fire-spend"
              type="number"
              value={monthlySpend}
              onChange={(e) => {
                setMonthlySpend(Number(e.target.value) || 0);
              }}
              min={0}
              step={100}
            />
          </Field>
          <Field label="Monthly savings ($)" htmlFor="fire-savings">
            <Input
              id="fire-savings"
              type="number"
              value={monthlySavings}
              onChange={(e) => {
                setMonthlySavings(Number(e.target.value) || 0);
              }}
              min={0}
              step={100}
            />
          </Field>
          <Field label="Annual return (%)" htmlFor="fire-return">
            <Input
              id="fire-return"
              type="number"
              value={annualReturn}
              onChange={(e) => {
                setAnnualReturn(Number(e.target.value) || 0);
              }}
              step={0.5}
            />
          </Field>
          <Field label="Withdrawal rate (%)" htmlFor="fire-swr">
            <Input
              id="fire-swr"
              type="number"
              value={withdrawalRate}
              onChange={(e) => {
                setWithdrawalRate(Number(e.target.value) || 4.0);
              }}
              step={0.25}
            />
          </Field>
        </div>

        {/* Life-Event Milestones Scenario Injections */}
        <div className="rounded-field border border-panel-border/70 p-4">
          <h4 className="text-sm font-bold">Scheduled life event scenarios</h4>
          <p className="mt-1 text-xs text-muted">
            One-time windfalls or capital outlays that impact your independence timeline.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center gap-2 rounded-field bg-panel-2 px-3 py-1.5 text-xs font-medium"
              >
                <span>{ev.name}</span>
                <span className="font-mono text-muted">(Month {ev.monthOffset})</span>
                <span className={ev.oneTimeCashFlow >= 0 ? "text-success font-bold" : "text-danger font-bold"}>
                  {ev.oneTimeCashFlow >= 0 ? "+" : ""}
                  {formatCurrency(ev.oneTimeCashFlow)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeEvent(ev.id);
                  }}
                  aria-label={`Remove event ${ev.name}`}
                  className="ml-1 text-muted hover:text-foreground"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={addEvent} className="mt-4 grid gap-2 sm:grid-cols-4">
            <Input
              placeholder="Event name (e.g. Wedding, Sabbatical)"
              value={newEventName}
              onChange={(e) => {
                setNewEventName(e.target.value);
              }}
              className="sm:col-span-2"
            />
            <Input
              type="number"
              placeholder="Month in future (e.g. 18)"
              value={newEventMonth}
              onChange={(e) => {
                setNewEventMonth(Number(e.target.value));
              }}
            />
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Amount delta ($)"
                value={newEventCashFlow}
                onChange={(e) => {
                  setNewEventCashFlow(Number(e.target.value));
                }}
              />
              <Button type="submit" size="sm">
                Add
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Panel>
  );
}
