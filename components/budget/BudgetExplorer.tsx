"use client";

import { useState } from 'react';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import { formatCurrency, UNKNOWN_CURRENCY } from '@/lib/format';
import type { BudgetPageData } from '@/lib/budget-page';
import { defaultBudgetExplorer, editableExpense, previewBudgetTransfer, spendingPace, type BudgetExplorerOptions } from '@/lib/budget-explorer';

export default function BudgetExplorer({data, options, onChange, visibleCount, currency, today, complete}: Readonly<{
  data: BudgetPageData; options: BudgetExplorerOptions; onChange: (options: BudgetExplorerOptions)=>void;
  visibleCount: number; currency: string; today?: string; complete: boolean;
}>) {
  const lines = data.sections.flatMap(section=>section.lines);
  const pace = spendingPace(data.totalExpenses.actual,{month:data.month,today,complete,currency});
  return <Panel title="Explore this month">
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="min-w-0 text-sm">Search categories<Input value={options.query} onChange={e=>{onChange({...options,query:e.target.value});}} type="search" /></label>
      <label className="min-w-0 text-sm">Attention<Select value={options.attention} onChange={e=>{onChange({...options,attention:e.target.value as BudgetExplorerOptions['attention']});}}>
        <option value="all">All categories</option><option value="overspent">Overspent expenses</option><option value="unbudgeted">Unbudgeted expenses</option><option value="unused">Unused expense budgets</option>
      </Select></label>
      <label className="min-w-0 text-sm">Sort categories<Select value={options.sort} onChange={e=>{onChange({...options,sort:e.target.value as BudgetExplorerOptions['sort']});}}>
        <option value="planned">Planned order</option><option value="spending">Largest spending</option><option value="remaining">Least remaining</option><option value="name">Name</option>
      </Select></label>
    </div>
    <p className="mt-3 text-sm text-muted" aria-live="polite">Showing {visibleCount} of {lines.length} categories. All section and summary totals include the full budget. Sorting applies within each section.</p>
    <Button className="mt-2" variant="secondary" onClick={()=>{onChange({...defaultBudgetExplorer});}}>Reset exploration</Button>
    {pace !== null && <p className="mt-4 text-sm">Month-end spending pace: <strong data-money>{formatCurrency(pace,currency)}</strong>. Projection assumes unchanged daily spending pace; refunds reduce net expenses.</p>}
    <BudgetTransferPreview data={data} currency={currency} />
  </Panel>;
}

function BudgetTransferPreview({data, currency}: Readonly<{data: BudgetPageData; currency: string}>) {
  const [sourceId,setSourceId] = useState('');
  const [destinationId,setDestinationId] = useState('');
  const [amount,setAmount] = useState('');
  const lines = data.sections.flatMap(section=>section.lines);
  const editable = lines.filter(editableExpense);
  const transfer = amount !== '' ? previewBudgetTransfer(lines,sourceId,destinationId,Number(amount)) : null;
  const knownCurrency = /^[A-Z]{3}$/.test(currency) && currency !== UNKNOWN_CURRENCY;
  return (<details className="mt-4 rounded-field border border-panel-border p-3">
      <summary className="cursor-pointer text-sm font-semibold">Preview a budget transfer</summary>
      <p className="mt-2 text-sm text-muted">What-if only. This preview does not save a budget move.</p>
      {!knownCurrency && <p className="mt-2 text-sm">A known currency is required for a transfer preview.</p>}
      {knownCurrency && editable.length < 2 && <p className="mt-2 text-sm">Set up at least two editable expense categories to preview a transfer.</p>}
      {knownCurrency && editable.length >= 2 && <>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="min-w-0 text-sm">Transfer from<Select value={sourceId} onChange={e=>{setSourceId(e.target.value);}}><option value="">Choose category</option>{editable.map(line=><option key={line.budgetId!} value={line.budgetId!}>{line.label}</option>)}</Select></label>
          <label className="min-w-0 text-sm">Transfer to<Select value={destinationId} onChange={e=>{setDestinationId(e.target.value);}}><option value="">Choose category</option>{editable.map(line=><option key={line.budgetId!} value={line.budgetId!}>{line.label}</option>)}</Select></label>
          <label className="min-w-0 text-sm">Transfer amount<Input data-money type="number" min="0.01" step="0.01" value={amount} aria-invalid={transfer?.ok === false} onChange={e=>{setAmount(e.target.value);}} /></label>
        </div>
        <div aria-live="polite" className="mt-3 text-sm">
          {transfer?.ok === false && <p role="alert">{transfer.error}</p>}
          {transfer?.ok && <>
            {[transfer.source,transfer.destination].map(after=>{
              const before = lines.find(line=>line.budgetId === after.budgetId)!;
              return <p key={after.budgetId} className="mt-2"><strong>{after.label}</strong>: planned <span data-money>{formatCurrency(before.planned,currency)} → {formatCurrency(after.planned,currency)}</span>; remaining <span data-money>{formatCurrency(before.remaining,currency)} → {formatCurrency(after.remaining,currency)}</span>.</p>;
            })}
            <p className="mt-2">Overall planned spending stays <span data-money>{formatCurrency(transfer.totalPlanned,currency)}</span>.</p>
          </>}
        </div>
        <Button className="mt-3" variant="secondary" onClick={()=>{setSourceId('');setDestinationId('');setAmount('');}}>Reset transfer preview</Button>
      </>}
    </details>);
}
