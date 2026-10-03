"use client";

import { useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import FormMessage from "@/components/ui/FormMessage";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import {
  buildLookthroughSummary,
  parseLookthroughData,
  type LookthroughHolding,
  type LookthroughRecord,
} from "@/lib/portfolio-lookthrough";

interface PortfolioLookthroughProps {
  holdings: LookthroughHolding[];
  initialRecords: LookthroughRecord[];
}

interface Draft {
  asOfDate: string;
  weights: string;
  message: string | null;
  saving: boolean;
}

const FUND_TYPES = new Set(["etf", "mutual fund"]);
const BAR_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];

function configurable(holding: LookthroughHolding): boolean {
  return !holding.ticker || !holding.securityType || FUND_TYPES.has(holding.securityType.toLowerCase());
}

function draftFor(record: LookthroughRecord | undefined): Draft {
  return {
    asOfDate: record?.asOfDate ?? "",
    weights: record
      ? JSON.stringify(record.weights.map(({ key, name, sector, region, weight }) => ({ key, name, sector, region, weightPct: Math.round(weight * 10000) / 100 })), null, 2)
      : '[\n  {"key":"ticker:EXAMPLE","name":"Example security","sector":"Technology","region":"North America","weightPct":100}\n]',
    message: null,
    saving: false,
  };
}

function ExposureTable({ rows, currency, caption }: Readonly<{ rows: ReturnType<typeof buildLookthroughSummary>["bySecurity"]; currency: string; caption: string }>) {
  const tableRef = useRef<HTMLDivElement>(null);
  function scrollTable(distance: number) {
    tableRef.current?.scrollBy({ left: distance, behavior: "smooth" });
  }

  return (
    <div ref={tableRef} className="overflow-x-auto" aria-label={`${caption} table; use the scroll controls for more columns`}>
      <div className="flex justify-end gap-1 pb-1">
        <button type="button" className="sr-only rounded-field px-2 py-1 text-xs focus:not-sr-only focus-visible:outline-2" onClick={() => { scrollTable(-240); }}>Scroll left</button>
        <button type="button" className="sr-only rounded-field px-2 py-1 text-xs focus:not-sr-only focus-visible:outline-2" onClick={() => { scrollTable(240); }}>Scroll right</button>
      </div>
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="py-2 pr-4">Name</th>
            <th scope="col" className="py-2 pr-4">Value</th>
            <th scope="col" className="py-2 pr-4">Weight</th>
            <th scope="col" className="py-2">Contributing holdings</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-panel-border">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="max-w-48 py-2 pr-4 font-medium">
                <span className="block truncate">{row.name}</span>
                <span className="block truncate text-xs font-normal text-muted">{row.key}</span>
              </th>
              <td data-money className="whitespace-nowrap py-2 pr-4 tabular-nums">{formatCurrency(row.value, currency)}</td>
              <td className="whitespace-nowrap py-2 pr-4 tabular-nums">{row.weightPct.toFixed(1)}%</td>
              <td className="py-2 text-xs text-muted">{row.contributors.map((contributor) => contributor.holdingName).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegionView({ rows, currency }: Readonly<{ rows: ReturnType<typeof buildLookthroughSummary>["byRegion"]; currency: string }>) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted">World map (schematic)</p>
      <div role="img" aria-label="Schematic world map of regional exposure" className="grid min-h-36 grid-cols-5 grid-rows-3 gap-1 rounded-field border border-panel-border bg-panel-2 p-2">
        {rows.slice(0, 6).map((row, index) => <div key={`map-${row.key}`} className="min-w-0 rounded-field border border-panel-border bg-panel px-1 py-2 text-center text-[10px]" style={{ borderTopColor: BAR_COLORS[index % BAR_COLORS.length] }}><span className="block truncate">{row.name}</span><span className="block tabular-nums text-muted">{row.weightPct.toFixed(1)}%</span></div>)}
      </div>
      <div aria-label="Regional exposure bars" className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.key}>
            <div className="mb-1 flex justify-between gap-3 text-xs">
              <span className="truncate">{row.name}</span>
              <span className="tabular-nums text-muted">{row.weightPct.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full" style={{ width: `${Math.min(row.weightPct, 100)}%`, backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }} />
            </div>
          </div>
        ))}
      </div>
      {/* Table twin keeps the chart's exact data available without color or geometry. */}
      <ExposureTable rows={rows} currency={currency} caption="Regional exposure" />
    </div>
  );
}

export default function PortfolioLookthrough({ holdings, initialRecords }: Readonly<PortfolioLookthroughProps>) {
  const [records, setRecords] = useState(initialRecords);
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => new Map(
    holdings.filter(configurable).map((holding) => [holding.id, draftFor(records.find((record) => record.holdingId === holding.id))]),
  ));
  const summary = useMemo(() => buildLookthroughSummary(holdings, records), [holdings, records]);
  const recordByHolding = new Map(records.map((record) => [record.holdingId, record]));
  const editableHoldings = holdings.filter(configurable);

  function updateDraft(holdingId: string, update: Partial<Draft>) {
    setDrafts((current) => {
      const existing = current.get(holdingId) ?? draftFor(undefined);
      const nextDraft: Draft = {
        asOfDate: update.asOfDate ?? existing.asOfDate,
        weights: update.weights ?? existing.weights,
        message: update.message ?? existing.message,
        saving: update.saving ?? existing.saving,
      };
      const next = new Map(current);
      next.set(holdingId, nextDraft);
      return next;
    });
  }

  function getDraft(holdingId: string, record?: LookthroughRecord): Draft {
    return drafts.get(holdingId) ?? draftFor(record);
  }

  async function save(holding: LookthroughHolding) {
    const draft = getDraft(holding.id, recordByHolding.get(holding.id));
    updateDraft(holding.id, { message: "", saving: true });
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(draft.weights);
    } catch {
      updateDraft(holding.id, { message: "Enter constituent weights as valid JSON.", saving: false });
      return;
    }
    if (!Array.isArray(parsedJson)) {
      updateDraft(holding.id, { message: "Constituents must be a JSON array.", saving: false });
      return;
    }
    const normalized = parsedJson.map((row) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
      const item = row as Record<string, unknown>;
      const weightPct = item.weightPct;
      return typeof weightPct === "number"
        ? { key: item.key, name: item.name, sector: item.sector, region: item.region, weight: weightPct / 100 }
        : { key: item.key, name: item.name, sector: item.sector, region: item.region, weight: item.weight };
    });
    const parsed = parseLookthroughData({ weights: normalized, asOfDate: draft.asOfDate });
    if (!parsed.ok) {
      updateDraft(holding.id, { message: parsed.error, saving: false });
      return;
    }
    const current = recordByHolding.get(holding.id);
    const response = await fetch("/api/portfolio-lookthrough", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ holdingId: holding.id, version: current?.version ?? 0, data: { weights: parsed.weights, asOfDate: parsed.asOfDate } }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; version?: number };
    if (!response.ok || typeof payload.version !== "number" || !Number.isInteger(payload.version)) {
      updateDraft(holding.id, { message: payload.error ?? "Could not save look-through data.", saving: false });
      return;
    }
    const next: LookthroughRecord = { holdingId: holding.id, version: payload.version, source: "manual", asOfDate: parsed.asOfDate, weights: parsed.weights };
    setRecords((currentRecords) => [...currentRecords.filter((record) => record.holdingId !== holding.id), next]);
    updateDraft(holding.id, { message: "Saved.", saving: false });
  }

  async function reset(holding: LookthroughHolding) {
    const current = recordByHolding.get(holding.id);
    if (!current) return;
    updateDraft(holding.id, { message: "", saving: true });
    const response = await fetch("/api/portfolio-lookthrough", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ holdingId: holding.id, version: current.version, data: null }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; version?: number };
    if (!response.ok || payload.version !== 0) {
      updateDraft(holding.id, { message: payload.error ?? "Could not remove look-through data.", saving: false });
      return;
    }
    setRecords((currentRecords) => currentRecords.filter((record) => record.holdingId !== holding.id));
    updateDraft(holding.id, { ...draftFor(undefined), message: "Removed.", saving: false });
  }

  return (
    <Panel title="Portfolio look-through" eyebrow="Manual constituents" padding="lg">
      <p className="text-sm text-muted">
        Add your own fund or private-asset constituents to see stock, sector, and regional exposure.
        FundFlow does not fetch or license market data here.
      </p>
      <p className="mt-2 text-xs text-muted">Source: manual user-entered weights · As of: {summary.asOfDate ?? "not set"}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><p className="text-xs text-muted">Covered</p><p className="text-lg font-semibold tabular-nums">{summary.coveragePct === null ? "-" : `${summary.coveragePct.toFixed(1)}%`}</p></div>
        <div><p className="text-xs text-muted">Known value</p><p data-money className="text-lg font-semibold tabular-nums">{formatCurrency(summary.coveredValue)}</p></div>
        <div><p className="text-xs text-muted">Unknown value</p><p data-money className="text-lg font-semibold tabular-nums">{formatCurrency(summary.unknownValue)}</p></div>
        <div><p className="text-xs text-muted">As of</p><p className="text-lg font-semibold">{summary.asOfDate ?? "Not set"}</p></div>
      </div>
      <div className="mt-6 space-y-6">
        <section aria-labelledby="lookthrough-security-heading">
          <h3 id="lookthrough-security-heading" className="text-sm font-semibold">By security</h3>
          {summary.bySecurity.length > 0 ? <ExposureTable rows={summary.bySecurity} currency="USD" caption="Security exposure" /> : <p className="mt-2 text-sm text-muted">No covered holdings yet.</p>}
        </section>
        <section aria-labelledby="lookthrough-sector-heading">
          <h3 id="lookthrough-sector-heading" className="text-sm font-semibold">By sector</h3>
          <div className="mt-2">{summary.bySector.length > 0 ? <ExposureTable rows={summary.bySector} currency="USD" caption="Sector exposure" /> : <p className="text-sm text-muted">No sector data yet.</p>}</div>
        </section>
        <section aria-labelledby="lookthrough-region-heading">
          <h3 id="lookthrough-region-heading" className="text-sm font-semibold">By region</h3>
          <div className="mt-2">{summary.byRegion.length > 0 ? <RegionView rows={summary.byRegion} currency="USD" /> : <p className="text-sm text-muted">No regional data yet.</p>}</div>
        </section>
      </div>
      {summary.unknownHoldingCount > 0 && <p className="mt-5 text-xs text-muted">{summary.unknownHoldingCount} holding{summary.unknownHoldingCount === 1 ? " is" : "s are"} not covered. Add manual constituents below to improve coverage.</p>}
      {editableHoldings.length > 0 && (
        <div className="mt-6 space-y-4 border-t border-panel-border pt-5">
          <h3 className="text-sm font-semibold">Constituent weights</h3>
          {editableHoldings.map((holding) => {
            const draft = getDraft(holding.id, recordByHolding.get(holding.id));
            return (
              <form key={holding.id} className="rounded-field border border-panel-border bg-panel-2 p-4" onSubmit={(event) => { event.preventDefault(); void save(holding); }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h4 className="font-medium">{holding.securityName}</h4><p className="text-xs text-muted">{holding.ticker ?? "No ticker"} · <span data-money>{formatCurrency(holding.value, "USD")}</span></p></div>
                  <span className="text-xs text-muted">{recordByHolding.has(holding.id) ? "Manual source" : "Not configured"}</span>
                </div>
                <label className="mt-3 block text-xs font-medium" htmlFor={`lookthrough-date-${holding.id}`}>Source as-of date</label>
                <Input id={`lookthrough-date-${holding.id}`} type="date" value={draft.asOfDate} onChange={(event) => { updateDraft(holding.id, { asOfDate: event.target.value, message: "" }); }} required className="mt-1" />
                <label className="mt-3 block text-xs font-medium" htmlFor={`lookthrough-weights-${holding.id}`}>Weights (percentages must add to 100)</label>
                <textarea id={`lookthrough-weights-${holding.id}`} value={draft.weights} onChange={(event) => { updateDraft(holding.id, { weights: event.target.value, message: "" }); }} rows={5} spellCheck={false} className="mt-1 min-h-32 w-full rounded-field border border-panel-border bg-panel px-3 py-2 font-mono text-xs text-foreground focus:border-accent focus-visible:outline-2" aria-describedby={`lookthrough-help-${holding.id}`} />
                <p id={`lookthrough-help-${holding.id}`} className="mt-1 text-xs text-muted">Use stable keys such as ticker:AAPL. Example fields: key, name, sector, region, weightPct.</p>
                <FormMessage message={draft.message} type={draft.message === "Saved." || draft.message === "Removed." ? "status" : "error"} className="mt-2" />
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {recordByHolding.has(holding.id) && <Button type="button" variant="ghost" size="sm" onClick={() => { void reset(holding); }} loading={draft.saving}>Remove</Button>}
                  <Button type="submit" size="sm" loading={draft.saving}>Save weights</Button>
                </div>
              </form>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
