import { describe, expect, it } from 'vitest';
import { exploreBudgetLines, spendingPace, previewBudgetTransfer } from '@/lib/budget-explorer';
import type { BudgetLine } from '@/lib/budget-page';
const line = (id: string, patch: Partial<BudgetLine> = {}): BudgetLine => ({budgetId:id, category:id, label:id, basePlanned:100, planned:100, actual:20, remaining:80, budgeted:true, group:'flexible', rolloverEnabled:false, rolloverCarry:0, sortOrder:0, ...patch});
describe('budget exploration', () => {
 it('searches literally, preserves sources and excludes income from expense attention', () => {
 const rows = [line('Food [1]'), line('income', {group:'income', actual:200, remaining:100}), line('over',{actual:120,remaining:-20}), line('new',{budgetId:null,budgeted:false,planned:0,actual:10}), line('unused',{actual:0})];
 expect(exploreBudgetLines(rows,{query:'[1]',attention:'all',sort:'planned'}).map(x=>x.category)).toEqual(['Food [1]']);
 expect(exploreBudgetLines(rows,{query:'',attention:'overspent',sort:'name'}).map(x=>x.category)).toEqual(['over','new'].sort());
 expect(exploreBudgetLines(rows,{query:'',attention:'unbudgeted',sort:'name'}).map(x=>x.category)).toEqual(['new']);
 expect(exploreBudgetLines(rows,{query:'',attention:'unused',sort:'name'}).map(x=>x.category)).toEqual(['unused']);
 expect(rows[0].category).toBe('Food [1]');
 });
 it('sorts spending and remaining with deterministic ties',()=>{
 const rows=[line('b'),line('a'),line('c',{actual:50,remaining:50})];
 expect(exploreBudgetLines(rows,{query:'',attention:'all',sort:'spending'}).map(x=>x.category)).toEqual(['c','a','b']);
 expect(exploreBudgetLines(rows,{query:'',attention:'all',sort:'remaining'}).map(x=>x.category)).toEqual(['c','a','b']);
 });
 it('projects net spending only with explicit valid current date and complete known currency',()=>{
 const context={month:'2028-02',today:'2028-02-10',complete:true,currency:'USD'};
 expect(spendingPace(100,context)).toBe(290);
 expect(spendingPace(-10,context)).toBe(-29);
 for(const patch of [{today:undefined},{today:'2028-02-30'},{today:'2028-03-01'},{complete:false},{currency:'UNKNOWN'},{currency:''}]) expect(spendingPace(100,{...context,...patch})).toBeNull();
 expect(spendingPace(Infinity,context)).toBeNull();
 });
 it('rejects invalid projection dates and unsafe amounts',()=>{
 for(const today of ['2028-13-01','2028-00-01','2028-02-00','0099-02-01','bad']) expect(spendingPace(10,{month:today.slice(0,7),today,complete:true,currency:'USD'})).toBeNull();
 expect(spendingPace(1e20,{month:'2028-02',today:'2028-02-01',complete:true,currency:'USD'})).toBeNull();
 for(const patch of [{remaining:NaN},{planned:Infinity},{basePlanned:1e20}]) expect(previewBudgetTransfer([line('a',patch),line('b')],'a','b',1).ok).toBe(false);
 expect(previewBudgetTransfer([line('a'),line('b',{planned:Number.MAX_SAFE_INTEGER/100})],'a','b',1).ok).toBe(false);
 expect(previewBudgetTransfer([line('a'),line('b')],'missing','b',1).ok).toBe(false);
 const tied=[line('same',{budgetId:null}),line('same',{budgetId:'z'})];
 expect(exploreBudgetLines(tied,{query:'',attention:'all',sort:'name'})[0].budgetId).toBeNull();
 });
 it('previews immutable cent-exact transfers bounded by base allocation and remaining',()=>{
 const rows=[line('a'),line('b')]; const before=JSON.stringify(rows);
 expect(previewBudgetTransfer(rows,'a','b',25)).toMatchObject({ok:true,source:{planned:75,remaining:55},destination:{planned:125,remaining:105},totalPlanned:200});
 expect(JSON.stringify(rows)).toBe(before);
 for(const amount of [0,-1,NaN,Infinity,0.001,81,1e20]) expect(previewBudgetTransfer(rows,'a','b',amount).ok).toBe(false);
 expect(previewBudgetTransfer(rows,'a','a',1).ok).toBe(false);
 expect(previewBudgetTransfer([line('a',{group:'income'}),line('b')],'a','b',1).ok).toBe(false);
 expect(previewBudgetTransfer([line('a',{basePlanned:5}),line('b')],'a','b',6).ok).toBe(false);
 });
});
