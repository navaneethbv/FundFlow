import type { BudgetLine } from './budget-page';
import { UNKNOWN_CURRENCY } from './format';

export interface BudgetExplorerOptions {
  query: string;
  attention: 'all' | 'overspent' | 'unbudgeted' | 'unused';
  sort: 'planned' | 'spending' | 'remaining' | 'name';
}
export const defaultBudgetExplorer: BudgetExplorerOptions = { query: '', attention: 'all', sort: 'planned' };

export function exploreBudgetLines(lines: readonly BudgetLine[], options: BudgetExplorerOptions): BudgetLine[] {
  const query = options.query.trim().toLowerCase();
  return lines.filter(line => {
    if (!`${line.label}\n${line.category}`.toLowerCase().includes(query)) return false;
    if (options.attention === 'all') return true;
    if (line.group === 'income') return false;
    if (options.attention === 'overspent') return line.actual > line.planned;
    if (options.attention === 'unbudgeted') return !line.budgeted;
    return line.planned > 0 && line.actual === 0;
  }).sort((a,b) => {
    let difference = 0;
    if (options.sort === 'spending') difference = b.actual - a.actual;
    if (options.sort === 'remaining') difference = a.remaining - b.remaining;
    if (options.sort === 'planned') difference = a.sortOrder - b.sortOrder;
    return difference || a.label.localeCompare(b.label) || a.category.localeCompare(b.category) || (a.budgetId ?? '').localeCompare(b.budgetId ?? '');
  });
}

export function spendingPace(actual: number, context: {month: string; today?: string; complete: boolean; currency: string}): number | null {
  const {month,today,complete,currency} = context;
  if (!complete || !today || !/^\d{4}-\d{2}-\d{2}$/.test(today) || today.slice(0,7) !== month || !/^[A-Z]{3}$/.test(currency) || currency === UNKNOWN_CURRENCY || !Number.isFinite(actual)) return null;
  const [year,mo,day] = today.split('-').map(Number);
  const days = new Date(Date.UTC(year,mo,0)).getUTCDate();
  if (year < 100 || mo < 1 || mo > 12 || day < 1 || day > days) return null;
  const result = Math.round(actual/day*days*100)/100;
  return Number.isSafeInteger(Math.round(result*100)) ? result : null;
}

export function editableExpense(line: BudgetLine): line is BudgetLine & { budgetId: string } {
  return line.group !== 'income' && line.budgeted && !!line.budgetId;
}

type TransferResult = {ok: false; error: string} | {ok: true; source: BudgetLine; destination: BudgetLine; totalPlanned: number};
export function previewBudgetTransfer(lines: readonly BudgetLine[], sourceId: string, destinationId: string, amount: number): TransferResult {
  const error = (message: string): TransferResult => ({ok:false,error:message});
  const source = lines.find(line=>line.budgetId === sourceId);
  const destination = lines.find(line=>line.budgetId === destinationId);
  if (!source || !destination || sourceId === destinationId || !editableExpense(source) || !editableExpense(destination)) return error('Choose two distinct editable expense categories.');
  const cents = Math.round(amount*100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents) || Math.abs(amount*100-cents)>0.000001) return error('Enter a positive amount with at most two decimal places.');
  if (![source.basePlanned,source.planned,source.remaining,destination.basePlanned,destination.planned,destination.remaining].every(value=>Number.isFinite(value) && Number.isSafeInteger(Math.round(value*100)))) return error('These categories have invalid amounts.');
  if (cents > Math.round(Math.min(source.basePlanned,source.planned,source.remaining)*100)) return error('Amount exceeds the source category’s remaining or planned allocation.');
  const change = (line: BudgetLine, delta: number): BudgetLine => ({...line,basePlanned:(Math.round(line.basePlanned*100)+delta)/100,planned:(Math.round(line.planned*100)+delta)/100,remaining:(Math.round(line.remaining*100)+delta)/100});
  const totalCents = lines.filter(line=>line.group !== 'income').reduce((sum,line)=>sum+Math.round(line.planned*100),0);
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(Math.round(destination.planned*100)+cents) || !Number.isSafeInteger(Math.round(destination.basePlanned*100)+cents)) return error('Amounts exceed the supported preview range.');
  return {ok:true,source:change(source,-cents),destination:change(destination,cents),totalPlanned:totalCents/100};
}
