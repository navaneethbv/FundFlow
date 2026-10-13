import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { rolldown } from 'rolldown';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
let script: string;
let css: string;
test.beforeAll(async()=>{
 const root=process.cwd();
 const bundle=await rolldown({input:'fixture',platform:'browser',resolve:{alias:{'@':root}},transform:{define:{'process.env.NODE_ENV':'"production"'},jsx:'react-jsx'},onwarn(warning,warn){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')warn(warning);},plugins:[{
 name:'fixture',resolveId(id){if(['fixture','next/navigation','next/link'].includes(id))return '\0'+id;},load(id){
 if(id==='\0next/navigation')return 'export const useRouter=()=>({refresh(){}});';
 if(id==='\0next/link')return 'import {createElement} from "react"; export const useLinkStatus=()=>({pending:false}); export default function Link(props){return createElement("a",props);}';
 if(id==='\0fixture')return `
 import {createElement as h} from 'react'; import {createRoot} from 'react-dom/client';
 import BudgetPlanner from ${JSON.stringify(path.join(root,'components/budget/BudgetPlanner.tsx'))};
 const line=(id,actual,planned=100,budgeted=true)=>({budgetId:budgeted?id:null,category:id,label:id,basePlanned:planned,planned,actual,remaining:planned-actual,budgeted,group:'flexible',rolloverEnabled:false,rolloverCarry:0,sortOrder:0});
 const lines=[line('Dining',120),line('Groceries',20),line('Travel',0),line('Taxi',10,0,false)];
 const section={key:'flexible',label:'Flexible',planned:300,actual:150,remaining:150,lines,unbudgetedCount:1};
 const data={month:'2028-02',horizon:'monthly',sections:[{key:'income',label:'Income',planned:0,actual:0,remaining:0,lines:[],unbudgetedCount:0},section],totalIncome:{planned:0,actual:0},totalExpenses:{planned:300,actual:150,remaining:150},contributions:{goals:[]},leftToBudget:-300,sinkingFundsTotal:0};
 createRoot(document.getElementById('root')).render(h('main',{style:{padding:16}},h('h1',{},'Budget'),h(BudgetPlanner,{initialView:{horizon:'monthly',month:data},proposals:[],month:data.month,currency:'USD',summaryTab:'summary',summaryLinks:{summary:'#',income:'#',expenses:'#'},viewerToday:'2028-02-10',dataComplete:true})));`;
 }}]});try{script=(await bundle.generate({format:'iife'})).output[0]!.code;}finally{await bundle.close();}
 const source=path.join(root,'app/globals.css');css=(await postcss([tailwind()]).process(await readFile(source,'utf8'),{from:source})).css;
});
for(const width of [375,1440])test(`budget exploration and immutable preview at ${width}px`,async({page})=>{
 const failures:string[]=[];const mutations:string[]=[];
 page.on('pageerror',error=>failures.push(error.message));page.on('request',request=>{if(request.method()!=='GET')mutations.push(request.url());});
 await page.setViewportSize({width,height:1000});
 await page.route('http://fundflow.test/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><title>Budget</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('http://fundflow.test/budget');
 await expect(page.getByText('Showing 4 of 4 categories.',{exact:false})).toBeVisible();
 await expect(page.getByText('Month-end spending pace:',{exact:false})).toContainText('$435');
 await page.getByLabel('Search categories').fill('groC');
 await expect(page.getByText('Showing 1 of 4 categories.',{exact:false})).toBeVisible();
 await expect(page.getByLabel('Planned amount for Groceries').filter({visible:true})).toBeVisible();
 await page.getByRole('button',{name:'Reset exploration'}).click();
 await page.getByRole('combobox',{name:'Attention',exact:true}).selectOption('unbudgeted');
 await expect(page.getByText('Taxi',{exact:true}).filter({visible:true})).toBeVisible();
 await expect(page.getByText('Showing 1 of 4 categories.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Reset exploration'}).click();
 await page.getByRole('combobox',{name:'Attention',exact:true}).selectOption('overspent');
 await expect(page.getByText('Showing 2 of 4 categories.',{exact:false})).toBeVisible();
 await page.getByRole('combobox',{name:'Attention',exact:true}).selectOption('unused');
 await expect(page.getByLabel('Planned amount for Travel').filter({visible:true})).toBeVisible();
 await page.getByRole('button',{name:'Reset exploration'}).click();
 await page.getByRole('combobox',{name:'Sort categories',exact:true}).selectOption('spending');
 expect(await page.locator('input[aria-label^="Planned amount"]:visible').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))).toEqual(['Planned amount for Dining','Planned amount for Groceries','Planned amount for Travel']);
 await page.getByText('Preview a budget transfer',{exact:true}).focus();
 await page.keyboard.press('Enter');
 await page.getByRole('combobox',{name:'Transfer from',exact:true}).selectOption('Groceries');await page.getByRole('combobox',{name:'Transfer to',exact:true}).selectOption('Travel');
 await page.getByLabel('Transfer amount').fill('81');await expect(page.getByRole('alert')).toContainText('exceeds');
 await page.getByLabel('Transfer amount').fill('25');await expect(page.getByText('Overall planned spending stays',{exact:false})).toContainText('$300');
 await expect(page.getByLabel('Planned amount for Groceries').filter({visible:true})).toHaveValue('100');
 await page.evaluate(()=>document.documentElement.dataset.privacy='blur');
 expect(await page.getByLabel('Transfer amount').evaluate(el=>getComputedStyle(el).filter)).toContain('blur');
 await page.evaluate(()=>delete document.documentElement.dataset.privacy);
 await page.getByRole('button',{name:'Reset transfer preview'}).click();await expect(page.getByLabel('Transfer amount')).toHaveValue('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 expect(failures).toEqual([]);expect(mutations).toEqual([]);expect(new URL(page.url()).search).toBe('');
});
