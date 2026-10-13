'use client';

import { useMemo, useState } from 'react';
import Panel from '@/components/ui/Panel';
import ScrollableRegion from '@/components/ui/ScrollableRegion';
import { buttonVariants } from '@/components/ui/Button';
import type { DebtPlannerAccount, DebtStrategy } from '@/lib/debt-data';
import type { ScheduledPayoffPlan } from '@/lib/debt';
import {
  buildDebtScenario, debtPaymentLadder, solveDebtExtra,
  MAX_DEBT_MONEY, MAX_DEBT_APR,
} from '@/lib/debt-scenarios';
import { formatCurrency } from '@/lib/format';

type Assumption = { apr: string; minimum: string };
type Draft = { lump: string; extra: string; horizon: string; overrides: Map<string, Assumption> };
type Props = { debts: DebtPlannerAccount[]; strategy: DebtStrategy; extraMonthly: number; currency: string };
const fieldClass = 'money min-h-11 w-full min-w-0 rounded-field border border-panel-border bg-panel-2 px-3 text-foreground';

function defaults(extraMonthly: number): Draft {
  return { lump: '0', extra: String(extraMonthly), horizon: '60', overrides: new Map() };
}

function assumption(debt: DebtPlannerAccount): Assumption {
  return { apr: debt.planned ? String(debt.apr) : '', minimum: String(debt.minimumPayment) };
}

function numeric(raw: string, maximum: number): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) > maximum) {
    throw new Error('Enter nonnegative numbers with at most two decimals within the displayed limits.');
  }
  return Number(raw);
}

function calculate(debts: DebtPlannerAccount[], strategy: DebtStrategy, draft: Draft) {
  try {
    const inputs = debts.flatMap(debt => {
      const values = draft.overrides.get(debt.id) ?? assumption(debt);
      // A blank rate deliberately excludes an account, including missing-rate loans.
      if (values.apr === '') return [];
      return [{ name: debt.id, balance: debt.balance, apr: numeric(values.apr, MAX_DEBT_APR), minPayment: numeric(values.minimum, MAX_DEBT_MONEY) }];
    });
    if (!inputs.length) throw new Error('Enter an APR for at least one account to create a projection.');
    if (!/^\d+$/.test(draft.horizon)) throw new Error('Payoff horizon must be a whole number from 1 to 600 months.');
    const input = { debts: inputs, strategy, extraMonthly: numeric(draft.extra, MAX_DEBT_MONEY), lumpSum: numeric(draft.lump, MAX_DEBT_MONEY) };
    return {
      ok: true as const,
      scenario: buildDebtScenario(input),
      solver: solveDebtExtra(input, Number(draft.horizon)),
      ladder: debtPaymentLadder(input),
      excluded: debts.length - inputs.length,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Check your inputs.' };
  }
}

type Result = Extract<ReturnType<typeof calculate>, { ok: true }>;

function NumericField({ label, value, onChange, integer = false }: Readonly<{
  label: string; value: string; onChange: (value: string) => void; integer?: boolean;
}>) {
  return <label className="grid gap-1 text-sm">
    {label}
    <input aria-label={label} className={fieldClass} inputMode={integer ? 'numeric' : 'decimal'} value={value} onChange={event => { onChange(event.target.value); }} />
  </label>;
}

function AccountAssumptions({ debts, draft, onEdit }: Readonly<{
  debts: DebtPlannerAccount[]; draft: Draft;
  onEdit: (id: string, values: Assumption) => void;
}>) {
  return <div className="mt-4 space-y-3">{debts.map(debt => {
    const values = draft.overrides.get(debt.id) ?? assumption(debt);
    return <fieldset key={debt.id} className="min-w-0 rounded-field border border-panel-border p-3">
      <legend className="max-w-full break-words px-1 text-sm font-semibold">{debt.name}</legend>
      <p className="mb-2 text-xs text-muted">
        {debt.aprAssumed && debt.planned && '22% assumed card APR. '}
        {!debt.planned && 'APR required to include this loan. '}
        Minimum is an estimate until you enter your own assumption. Blank APR excludes the account.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">APR (%)
          <input aria-label={`${debt.name} APR ${debt.id}`} className={fieldClass} inputMode="decimal" value={values.apr} onChange={event => { onEdit(debt.id, { ...values, apr: event.target.value }); }} />
        </label>
        <label className="grid gap-1 text-sm">Monthly minimum assumption
          <input aria-label={`${debt.name} minimum ${debt.id}`} className={fieldClass} inputMode="decimal" value={values.minimum} onChange={event => { onEdit(debt.id, { ...values, minimum: event.target.value }); }} />
        </label>
      </div>
    </fieldset>;
  })}</div>;
}

function CombinedSchedule({ plan, currency }: Readonly<{ plan: ScheduledPayoffPlan | null; currency: string }>) {
  return <details className="mt-5">
    <summary className="cursor-pointer font-semibold">Combined monthly schedule</summary>
    <p className="my-2 text-xs text-muted">Opening balance is after the immediate payment. Final monthly payment is capped at the amount owed.</p>
    {!plan && <p className="text-sm">No complete schedule within calculation limits.</p>}
    {plan?.months === 0 && <p className="text-sm">No monthly payments needed.</p>}
    {plan && plan.months > 0 && <ScrollableRegion className="max-h-96 overflow-auto" label="Combined debt schedule">
      <table className="w-full min-w-[34rem] text-right text-sm">
        <thead><tr>{['Month', 'Opening balance', 'Interest', 'Payment', 'Closing balance'].map(title => <th key={title} className="p-2">{title}</th>)}</tr></thead>
        <tbody>{plan.schedule.map(row => <tr key={row.month}>
          <th className="p-2">{row.month}</th>
          {[row.openingBalance, row.interest, row.payment, row.closingBalance].map((value, index) => <td data-money key={index} className="p-2">{formatCurrency(value, currency)}</td>)}
        </tr>)}</tbody>
      </table>
    </ScrollableRegion>}
  </details>;
}

function Results({ result, currency }: Readonly<{ result: Result; currency: string }>) {
  const { scenario, solver } = result;
  const money = (value: number) => formatCurrency(value, currency);
  const payoff = scenario.plan ? `${scenario.plan.months} months; ${money(scenario.plan.totalInterest)} interest` : 'Not reached within calculation limits';
  const savings = scenario.interestSaved !== null ? `${money(scenario.interestSaved)} interest; ${scenario.monthsSaved} months` : 'Baseline does not clear within calculation limits';
  const required = solver.status === 'solved' ? `${money(solver.extraMonthly)} per month` : 'Unattainable within the amount limit';
  return <>
    {result.excluded > 0 && <p className="text-sm text-warning">{result.excluded} account(s) excluded until an APR is entered.</p>}
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt>Immediate payment applied</dt><dd data-money>{money(scenario.appliedLumpSum)}</dd></div>
      <div><dt>Scenario payoff</dt><dd data-money>{payoff}</dd></div>
      <div><dt>Savings versus no lump sum</dt><dd data-money>{savings}</dd></div>
      <div><dt>Minimum extra for target horizon</dt><dd data-money>{required}</dd></div>
    </dl>
    <h3 className="mt-5 font-semibold">Extra-payment ladder</h3>
    <p className="text-xs text-muted">Same lump sum and account assumptions; total extra above minimums.</p>
    <ul className="mt-2 space-y-1 text-sm">{result.ladder.map((row, index) => <li key={index}>
      <span data-money>{money(row.extraMonthly)} extra: {row.plan ? `${row.plan.months} months, ${money(row.plan.totalInterest)} interest` : 'not reached within calculation limits'}</span>
    </li>)}</ul>
    <CombinedSchedule plan={scenario.plan} currency={currency} />
  </>;
}

export default function DebtScenarioPlanner({ debts, strategy, extraMonthly, currency }: Readonly<Props>) {
  const [draft, setDraft] = useState(() => defaults(extraMonthly));
  const [applied, setApplied] = useState(() => defaults(extraMonthly));
  // Applying is explicit: the bounded solver never runs on every keystroke.
  const result = useMemo(() => calculate(debts, strategy, applied), [debts, strategy, applied]);
  function editAccount(id: string, values: Assumption) {
    setDraft(current => ({ ...current, overrides: new Map(current.overrides).set(id, values) }));
  }
  function reset() {
    setDraft(defaults(extraMonthly));
    setApplied(defaults(extraMonthly));
  }
  return <Panel title="Debt scenario planner" eyebrow={`Preview only · ${currency}`}>
    <p className="text-sm text-muted">Explore immediate payments and account assumptions. Edits stay on this page and never change accounts. Apply edits to refresh results; up to 100 accounts can be modeled.</p>
    <p className="mt-2 text-sm text-muted">Minimum payments start as estimates: the greater of 25 currency units or 2% of the starting balance. The projection holds the total monthly budget steady as debts clear, with unchanged APRs, no fees, and a 600-month limit. Amounts are rounded to cents. Projections stop if balances exceed safe cent precision.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <NumericField label="Immediate lump sum" value={draft.lump} onChange={lump => { setDraft(current => ({ ...current, lump })); }} />
      <NumericField label="Scenario extra monthly" value={draft.extra} onChange={extra => { setDraft(current => ({ ...current, extra })); }} />
      <NumericField label="Target payoff months" value={draft.horizon} integer onChange={horizon => { setDraft(current => ({ ...current, horizon })); }} />
    </div>
    <p className="mt-2 text-xs text-muted">Amounts: 0–1,000,000,000; APR: 0–1,000%; payoff horizon: 1–600 whole months. At most two decimal places for money and APR.</p>
    <AccountAssumptions debts={debts} draft={draft} onEdit={editAccount} />
    <button type="button" className={buttonVariants({ className: 'mt-4 mr-3' })} onClick={() => { setApplied(draft); }}>Apply debt scenario</button>
    <button type="button" className={buttonVariants({ variant: 'secondary', className: 'mt-4' })} onClick={reset}>Reset debt scenario</button>
    <div aria-live="polite" className="mt-4">
      {result.ok ? <Results result={result} currency={currency} /> : <p role="alert" className="text-sm text-warning">{result.error}</p>}
    </div>
  </Panel>;
}
