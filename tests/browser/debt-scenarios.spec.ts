import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { rolldown } from 'rolldown';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
let script: string, css: string;
test.beforeAll(async () => {
    const root = process.cwd();
    const bundle = await rolldown({ input: 'debt-fixture', platform: 'browser', onwarn(w, warn) { if (w.code !== 'MODULE_LEVEL_DIRECTIVE')
            warn(w); }, resolve: { alias: { '@': root } }, transform: { define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'react-jsx' }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'debt-fixture')
                    return '\0debt-fixture'; }, load(id) { if (id === '\0debt-fixture')
                    return `import {createElement as h,useState} from 'react';import{createRoot}from'react-dom/client';import Planner from ${JSON.stringify(path.join(root, 'components/debt/DebtScenarioPlanner.tsx'))};const debts=[{id:'a',name:'Visa',balance:1000,apr:22,aprAssumed:true,minimumPayment:25,planned:true},{id:'b',name:'Loan',balance:2000,apr:22,aprAssumed:true,minimumPayment:40,planned:false}];function App(){const [currency,setCurrency]=useState('EUR');return h('main',{style:{padding:16}},h('h1',{},'Debt scenarios'),h('button',{onClick:()=>setCurrency(currency==='EUR'?'USD':'EUR')},'Switch currency'),h(Planner,{key:currency,debts,strategy:'avalanche',extraMonthly:10,currency}));}createRoot(document.getElementById('root')).render(h(App));`; } }] });
    try {
        script = (await bundle.generate({ format: 'iife' })).output[0]!.code;
    }
    finally {
        await bundle.close();
    }
    const source = path.join(root, 'app/globals.css');
    css = (await postcss([tailwind()]).process(await readFile(source, 'utf8'), { from: source })).css;
});
for (const width of [375, 1440])
    test(`debt editing, validation, reset, privacy and accessibility at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const requests: string[] = [];
        page.on('request', r => requests.push(r.url()));
        await page.route('http://fundflow.test/**', r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Debt test</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>` }));
        await page.goto('http://fundflow.test/debt');
        await expect(page.getByText('1 account(s) excluded until an APR is entered.')).toBeVisible();
        await page.getByLabel('Loan APR b').fill('5');
        await page.getByLabel('Immediate lump sum', { exact: true }).fill('300');
        await page.getByRole('button', { name: 'Apply debt scenario' }).click();
        await expect(page.getByText('1 account(s) excluded until an APR is entered.')).toHaveCount(0);
        await page.getByText('Combined monthly schedule', { exact: true }).click();
        await expect(page.getByRole('table')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
        await page.screenshot({ path: `/tmp/fundflow-debt2-expanded-${width}.png`, fullPage: true });
    await page.getByLabel('Target payoff months', { exact: true }).fill('601');
        await page.getByRole('button', { name: 'Apply debt scenario' }).click();
        await expect(page.getByRole('alert')).toContainText('1 to 600');
        await page.getByRole('button', { name: 'Reset debt scenario' }).click();
        await expect(page.getByLabel('Immediate lump sum', { exact: true })).toHaveValue('0');
        await expect(page.getByLabel('Loan APR b')).toHaveValue('');
        await page.getByLabel('Immediate lump sum', { exact: true }).fill('200');
        await page.getByRole('button', { name: 'Switch currency' }).click();
        await expect(page.getByLabel('Immediate lump sum', { exact: true })).toHaveValue('0');
        await page.evaluate(() => document.documentElement.dataset.privacy = 'blur');
        expect(await page.getByLabel('Immediate lump sum', { exact: true }).evaluate(el => getComputedStyle(el).filter)).toContain('blur');
        expect(await page.locator('[data-money]').first().evaluate(el => getComputedStyle(el).filter)).toContain('blur');
        expect(page.url()).toBe('http://fundflow.test/debt');
        expect(requests).toEqual(['http://fundflow.test/debt']);
        expect(await page.evaluate(() => localStorage.length)).toBe(0);
        await page.screenshot({ path: `/tmp/fundflow-debt2-${width}.png`, fullPage: true });
    });
