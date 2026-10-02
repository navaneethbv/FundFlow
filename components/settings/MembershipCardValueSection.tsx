"use client";

import { useState, useTransition } from "react";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { localDateKey } from "@/lib/format-date";
import type { CardValueResult, CardValueTerms } from "@/lib/card-value";

function firstTerm(initial: CardValueTerms[]): CardValueTerms {
  const today = localDateKey();
  return initial[0] ?? {
    id: "membership-1",
    membershipName: "My membership",
    cardName: "My card",
    annualFee: 0,
    baselineAnnualFee: 0,
    anniversaryDate: today,
    confirmedOn: today,
    rewardTiers: [{ id: "base", label: "All eligible spend", rate: 0, cap: null, eligibleCategories: [] }],
    statementCredits: [],
    perks: [],
  };
}

function updateNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export default function MembershipCardValueSection({
  initialTerms,
  result,
}: Readonly<{ initialTerms: CardValueTerms[]; result: CardValueResult | null }>) {
  const [term, setTerm] = useState(() => firstTerm(initialTerms));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function update(field: keyof CardValueTerms, value: string | number) {
    setTerm((current) => ({ ...current, [field]: value }));
  }

  function updateRewardRate(value: string) {
    setTerm((current) => ({
      ...current,
      rewardTiers: current.rewardTiers.length > 0
        ? current.rewardTiers.map((tier, index) => index === 0 ? { ...tier, rate: Math.min(1, updateNumber(value) / 100) } : tier)
        : [{ id: "base", label: "All eligible spend", rate: Math.min(1, updateNumber(value) / 100), cap: null, eligibleCategories: [] }],
    }));
  }

  function updateCredit(index: number, patch: Partial<CardValueTerms["statementCredits"][number]>) {
    setTerm((current) => ({
      ...current,
      statementCredits: current.statementCredits.map((credit, creditIndex) => creditIndex === index ? { ...credit, ...patch } : credit),
    }));
  }

  function updatePerk(index: number, patch: Partial<CardValueTerms["perks"][number]>) {
    setTerm((current) => ({
      ...current,
      perks: current.perks.map((perk, perkIndex) => perkIndex === index ? { ...perk, ...patch } : perk),
    }));
  }

  function addCredit() {
    setTerm((current) => ({
      ...current,
      statementCredits: [...current.statementCredits, { id: `credit-${Date.now()}`, label: "Statement credit", amount: 0, eligibleCategories: [], expiresAfterMonths: null }],
    }));
  }

  function addPerk() {
    setTerm((current) => ({
      ...current,
      perks: [...current.perks, { id: `perk-${Date.now()}`, label: "Perk", low: 0, base: 0, high: 0, membershipOnly: true }],
    }));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/settings/card-value", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: [term] }),
      });
      setMessage(response.ok ? "Terms saved." : "Terms did not save. Check the fields and try again.");
    });
  }

  return (
    <div className="space-y-6">
      <Panel title="Membership and card value" eyebrow="User-maintained terms">
        <p className="text-sm text-muted">Enter your confirmed fee and reward terms. Typical rewards are never fetched from a rate catalog.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Membership name<input value={term.membershipName} onChange={(event) => update("membershipName", event.target.value)} disabled={pending} className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3" /></label>
          <label className="text-sm font-semibold">Card name<input value={term.cardName} onChange={(event) => update("cardName", event.target.value)} disabled={pending} className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3" /></label>
          <label className="text-sm font-semibold">Annual fee<input type="number" min="0" step="0.01" value={term.annualFee} onChange={(event) => update("annualFee", Number(event.target.value))} disabled={pending} className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3" /></label>
          <label className="text-sm font-semibold">Baseline card annual fee<input type="number" min="0" step="0.01" value={term.baselineAnnualFee} onChange={(event) => update("baselineAnnualFee", Number(event.target.value))} disabled={pending} className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3" /></label>
          <label className="text-sm font-semibold">Anniversary date<input type="date" value={term.anniversaryDate} onChange={(event) => update("anniversaryDate", event.target.value)} disabled={pending} className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3" /></label>
          <label className="text-sm font-semibold">Terms confirmed on<input type="date" value={term.confirmedOn} onChange={(event) => update("confirmedOn", event.target.value)} disabled={pending} className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3" /></label>
        </div>
        <div className="mt-5 space-y-3 border-t border-panel-border pt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Reward tier</h3>
              <p className="text-xs text-muted">Use a percentage and leave the category list empty for all eligible spend.</p>
            </div>
            <label className="text-sm font-semibold">Rate (%)<input type="number" min="0" max="100" step="0.01" value={((term.rewardTiers[0]?.rate ?? 0) * 100).toString()} onChange={(event) => updateRewardRate(event.target.value)} disabled={pending} className="mt-1 min-h-11 w-32 rounded-field border border-panel-border bg-background px-3" /></label>
          </div>
          <div className="space-y-2">
            {term.statementCredits.map((credit, index) => (
              <div key={credit.id} className="grid gap-2 rounded-field border border-panel-border p-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
                <label className="text-xs font-semibold">Credit label<input value={credit.label} onChange={(event) => updateCredit(index, { label: event.target.value })} disabled={pending} className="mt-1 min-h-10 w-full rounded-field border border-panel-border bg-background px-2" /></label>
                <label className="text-xs font-semibold">Amount<input type="number" min="0" step="0.01" value={credit.amount} onChange={(event) => updateCredit(index, { amount: updateNumber(event.target.value) })} disabled={pending} className="mt-1 min-h-10 w-full rounded-field border border-panel-border bg-background px-2" /></label>
                <label className="text-xs font-semibold">Expires (months)<input type="number" min="0" step="1" placeholder="Never" value={credit.expiresAfterMonths ?? ""} onChange={(event) => updateCredit(index, { expiresAfterMonths: event.target.value === "" ? null : Math.floor(updateNumber(event.target.value)) })} disabled={pending} className="mt-1 min-h-10 w-full rounded-field border border-panel-border bg-background px-2" /></label>
                <button type="button" onClick={() => setTerm((current) => ({ ...current, statementCredits: current.statementCredits.filter((_, creditIndex) => creditIndex !== index) }))} disabled={pending} className="min-h-10 rounded-field border border-panel-border px-3 text-xs font-semibold">Remove</button>
              </div>
            ))}
            <button type="button" onClick={addCredit} disabled={pending || term.statementCredits.length >= 20} className="min-h-10 rounded-field border border-panel-border px-3 text-xs font-semibold">Add statement credit</button>
          </div>
          <div className="space-y-2">
            {term.perks.map((perk, index) => (
              <div key={perk.id} className="grid gap-2 rounded-field border border-panel-border p-3 sm:grid-cols-[1fr_6rem_6rem_6rem_auto] sm:items-end">
                <label className="text-xs font-semibold">Perk label<input value={perk.label} onChange={(event) => updatePerk(index, { label: event.target.value })} disabled={pending} className="mt-1 min-h-10 w-full rounded-field border border-panel-border bg-background px-2" /></label>
                <label className="text-xs font-semibold">Low<input type="number" min="0" step="0.01" value={perk.low} onChange={(event) => updatePerk(index, { low: updateNumber(event.target.value) })} disabled={pending} className="mt-1 min-h-10 w-full rounded-field border border-panel-border bg-background px-2" /></label>
                <label className="text-xs font-semibold">Base<input type="number" min="0" step="0.01" value={perk.base} onChange={(event) => updatePerk(index, { base: updateNumber(event.target.value) })} disabled={pending} className="mt-1 min-h-10 w-full rounded-field border border-panel-border bg-background px-2" /></label>
                <label className="text-xs font-semibold">High<input type="number" min="0" step="0.01" value={perk.high} onChange={(event) => updatePerk(index, { high: updateNumber(event.target.value) })} disabled={pending} className="mt-1 min-h-10 w-full rounded-field border border-panel-border bg-background px-2" /></label>
                <button type="button" onClick={() => setTerm((current) => ({ ...current, perks: current.perks.filter((_, perkIndex) => perkIndex !== index) }))} disabled={pending} className="min-h-10 rounded-field border border-panel-border px-3 text-xs font-semibold">Remove</button>
              </div>
            ))}
            <button type="button" onClick={addPerk} disabled={pending || term.perks.length >= 20} className="min-h-10 rounded-field border border-panel-border px-3 text-xs font-semibold">Add subjective perk</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className="min-h-11 rounded-field bg-accent px-4 text-sm font-semibold text-accent-foreground">Save terms</button>
          {message && <output aria-live="polite" className="text-sm text-muted">{message}</output>}
        </div>
      </Panel>
      {result && (
        <Panel title="Value projection" eyebrow={`${result.anniversaryStart} to ${result.anniversaryEnd}`}>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div><dt className="text-xs uppercase tracking-wide text-muted">Measured rewards</dt><dd data-money className="mt-1 font-semibold">{formatCurrency(result.measuredRewards)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Projected rewards</dt><dd data-money className="mt-1 font-semibold">{formatCurrency(result.projectedRewards)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">History coverage</dt><dd className="mt-1 font-semibold">{Math.round(result.historyCoverage * 100)}%</dd></div>
          </dl>
          <div className="mt-4 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
            <p data-money>Value range: {formatCurrency(result.totalValue.low)} to {formatCurrency(result.totalValue.high)}</p>
            <p data-money className="mt-1 text-muted">Break-even spend: {result.breakEvenSpend === null ? "Unavailable at the entered reward rate" : formatCurrency(result.breakEvenSpend)}</p>
            {result.termsStale && <p className="mt-1 font-semibold text-warning">Terms may be stale. Confirm the fee and benefits again.</p>}
            <p className="mt-2 text-xs text-muted">Measured, projected, and subjective benefits are shown separately. Refunds reduce eligible spend; transfers and card payments are excluded.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}
