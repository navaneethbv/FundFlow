"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { applyLifeEvents, parseLifeEvent, type ForecastPoint, type LifeEvent, type LifeEventType } from "@/lib/life-events";
import { formatCurrency } from "@/lib/format";

const EVENT_LABELS: Record<LifeEventType, string> = {
  home_purchase: "Home purchase",
  child: "Child",
  income_change: "Income change",
  expense_change: "Expense change",
  retirement: "Retirement",
};

const EVENT_TYPES = Object.keys(EVENT_LABELS) as LifeEventType[];

interface Props {
  basePoints: ForecastPoint[];
  monthlySavings: number;
  currency: string;
  initialEvents: LifeEvent[];
}

/**
 * Life-event forecasting. Events are editable assumptions that recalibrate the
 * existing projection engine client-side; they are persisted only through the
 * authenticated life-events API and are never presented as guarantees.
 */
export default function LifeEventsPanel({
  basePoints,
  monthlySavings,
  currency,
  initialEvents,
}: Readonly<Props>) {
  const [events, setEvents] = useState<LifeEvent[]>(initialEvents);
  const [type, setType] = useState<LifeEventType>("home_purchase");
  const [startMonth, setStartMonth] = useState("1");
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adjusted = applyLifeEvents(basePoints, events, monthlySavings);
  const baseEnd = basePoints.at(-1)?.base ?? 0;
  const adjustedEnd = adjusted.at(-1)?.base ?? 0;

  async function addEvent() {
    setError(null);
    const parsed = parseLifeEvent({
      type,
      startMonth: Number(startMonth),
      amount: Number(amount),
      durationMonths: duration ? Number(duration) : null,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/forecasting/life-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.event),
      });
      const json = (await res.json().catch(() => null)) as { event?: LifeEvent; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? "Could not add the event.");
      if (json?.event) setEvents((current) => [...current, json.event!]);
      setAmount("");
      setDuration("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the event.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/forecasting/life-events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Could not remove the event.");
      setEvents((current) => current.filter((event) => event.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the event.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelShell>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
        Life events
      </h2>
      <p className="mb-4 text-sm text-muted">
        Add explicit, editable assumptions such as buying a home or having a child. The projection
        above recalibrates automatically. These are assumptions, not guarantees.
      </p>

      <ul className="mb-4 space-y-2 text-sm">
        {events.map((event) => (
          <li key={event.id ?? `${event.type}-${event.startMonth}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="font-medium">{EVENT_LABELS[event.type]}</span>
              <span className="text-muted"> · month {event.startMonth}{event.durationMonths ? ` · ${event.durationMonths} months` : ""}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatCurrency(event.amount, currency)}</span>
            <button
              type="button"
              onClick={() => void removeEvent(event.id!)}
              className="shrink-0 text-xs text-muted hover:text-danger"
              aria-label={`Remove ${EVENT_LABELS[event.type]} event`}
            >
              Remove
            </button>
          </li>
        ))}
        {events.length === 0 && <li className="text-sm text-muted">No life events configured.</li>}
      </ul>

      <div className="rounded-field border border-panel-border bg-panel-2 p-3">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <label className="col-span-2 block">
            <span className="text-xs text-muted">Event</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LifeEventType)}
              className="mt-1 w-full rounded-field border border-panel-border bg-panel px-2 py-1.5 text-sm"
            >
              {EVENT_TYPES.map((eventType) => (
                <option key={eventType} value={eventType}>{EVENT_LABELS[eventType]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted">Start month</span>
            <input
              type="number"
              min="1"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="mt-1 w-full rounded-field border border-panel-border bg-panel px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Amount</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-field border border-panel-border bg-panel px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Months (blank = forever)</span>
            <input
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="mt-1 w-full rounded-field border border-panel-border bg-panel px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Base-case end: <span className="money">{formatCurrency(baseEnd, currency)}</span> →{" "}
            <span className="money font-semibold">{formatCurrency(adjustedEnd, currency)}</span>
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={addEvent} loading={busy}>
            Add event
          </Button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </PanelShell>
  );
}

function PanelShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-w-0 rounded-card border border-panel-border bg-panel p-5 shadow-card">{children}</div>;
}