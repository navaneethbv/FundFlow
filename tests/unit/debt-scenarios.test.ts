import { describe, expect, it } from 'vitest';
import { buildDebtScenario, solveDebtExtra, debtPaymentLadder } from '@/lib/debt-scenarios';
import { buildDebtPlannerData } from '@/lib/debt-data';
const debts = [{ name: 'a', balance: 1000, apr: 12, minPayment: 50 }, { name: 'b', balance: 200, apr: 0, minPayment: 25 }];
const input = { debts, strategy: 'avalanche' as const, extraMonthly: 10, lumpSum: 100 };
describe('debt scenarios', () => {
    it('allocates immediate money in priority order and reconciles every monthly payment', () => {
        const result = buildDebtScenario(input);
        expect(result.appliedLumpSum).toBe(100);
        expect(result.remainingDebts[0].balance).toBe(900);
        expect(result.plan!.schedule[0].openingBalance).toBe(1100);
        for (const row of result.plan!.schedule)
            expect(Math.round((row.openingBalance + row.interest - row.payment) * 100)).toBe(Math.round(row.closingBalance * 100));
        expect(result.plan!.schedule.at(-1)!.closingBalance).toBe(0);
        expect(result.plan!.schedule.at(-1)!.payment).toBeLessThanOrEqual(85);
        expect(result.interestSaved).toBeGreaterThan(0);
        expect(debts[0].balance).toBe(1000);
    });
    it('caps lump sums and handles already cleared, zero rates and no debts', () => {
        const result = buildDebtScenario({ ...input, lumpSum: 9999 });
        expect(result.appliedLumpSum).toBe(1200);
        expect(result.plan?.months).toBe(0);
        expect(buildDebtScenario({ ...input, debts: [], lumpSum: 0 }).plan?.months).toBe(0);
    });
    it('finds the minimum cent that meets the horizon', () => {
        const result = solveDebtExtra({ ...input, lumpSum: 0 }, 12);
        expect(result.status).toBe('solved');
        if (result.status !== 'solved')
            return;
        expect(buildDebtScenario({ ...input, lumpSum: 0, extraMonthly: result.extraMonthly }).plan!.months).toBeLessThanOrEqual(12);
        expect(buildDebtScenario({ ...input, lumpSum: 0, extraMonthly: result.extraMonthly - .01 }).plan!.months).toBeGreaterThan(12);
        expect(solveDebtExtra(input, 1, 0).status).toBe('unattainable');
    });
    it('rejects nonfinite and out-of-bounds inputs', () => {
        for (const value of [NaN, Infinity, -1, 1000000001])
            expect(() => buildDebtScenario({ ...input, lumpSum: value })).toThrow();
        expect(() => solveDebtExtra(input, 0)).toThrow();
        expect(() => solveDebtExtra(input, 601)).toThrow();
        expect(() => buildDebtScenario({ ...input, debts: [{ ...debts[0], apr: Infinity }] })).toThrow();
    });
    it('compares fixed extra increments and retains account ids', () => {
        const ladder = debtPaymentLadder(input);
        expect(ladder.map(row => row.extraMonthly)).toEqual([10, 35, 60, 110, 260]);
        expect(ladder.at(-1)!.plan!.months).toBeLessThan(ladder[0].plan!.months);
        expect(buildDebtScenario(input).plan!.order).toEqual(['a', 'b']);
    });
    it('isolates known currencies and excludes unknown currency', () => {
        const accounts = [{ id: 'a', name: 'Card', balance: 100, apr: 0, currency: 'USD' }, { id: 'b', name: 'Card', balance: 200, apr: 0, currency: 'EUR' }, { id: 'c', name: 'Card', balance: 300, apr: 0, currency: null }];
        const result = buildDebtPlannerData(accounts, 0, 'EUR');
        expect(result.totalBalance).toBe(200);
        expect(result.debts.map(d => d.id)).toEqual(['b']);
        expect(result.availableCurrencies).toEqual(['EUR', 'USD']);
        expect(result.unknownCurrencyCount).toBe(1);
        expect(buildDebtPlannerData([accounts[2]], 0).totalBalance).toBe(0);
    });
});
describe('debt scenario boundaries', () => {
    it('retains the original monthly budget after an account clears immediately', () => {
        const result = buildDebtScenario({ debts: [{ name: 'small', balance: 100, apr: 0, minPayment: 25 }, { name: 'large', balance: 1000, apr: 0, minPayment: 100 }], strategy: 'snowball', extraMonthly: 0, lumpSum: 100 });
        expect(result.plan?.schedule[0].payment).toBe(125);
        expect(result.plan?.months).toBe(8);
    });
    it('keeps snowball lump allocation and ties deterministic', () => {
        const result = buildDebtScenario({ ...input, strategy: 'snowball', lumpSum: 250 });
        expect(result.remainingDebts.map(debt => [debt.name, debt.balance])).toEqual([['b', 0], ['a', 950]]);
    });
    it('rejects duplicate IDs and too many accounts without truncating', () => {
        expect(() => buildDebtScenario({ ...input, debts: [debts[0], debts[0]] })).toThrow('unique');
        expect(() => buildDebtScenario({ ...input, debts: Array.from({ length: 101 }, (_, index) => ({ ...debts[0], name: String(index) })) })).toThrow('100');
    });
    it('stops runaway capitalization before unsafe cents', () => {
        const result = buildDebtScenario({ debts: [{ name: 'small', balance: 900000, apr: 0, minPayment: 0 }, { name: 'expensive', balance: 1000000, apr: 1000, minPayment: 0 }], strategy: 'snowball', extraMonthly: 840000, lumpSum: 0 });
        expect(result.plan).toBeNull();
    });
    it('solver zero is minimal when the existing minimums suffice', () => {
        expect(solveDebtExtra({ ...input, lumpSum: 9999 }, 1)).toEqual({ status: 'solved', extraMonthly: 0 });
    });
    it('loader does not guess currency when provider supplies none', async () => {
        const { loadDebtPlannerData } = await import('@/lib/debt-data');
        const { clientStub } = await import('../fixtures/supabase-query');
        const client = clientStub({ accounts: { data: [{ id: 'unknown', name: 'Card', type: 'credit', current_balance: 500, apr: 20 }] } });
        const result = await loadDebtPlannerData(client as never, { scope: { kind: 'mine', ownerUserId: 'u' }, extraMonthly: 25 });
        expect(result.currency).toBeNull();
        expect(result.unknownCurrencyCount).toBe(1);
        expect(result.avalanche).toBeNull();
        expect(result.totalBalance).toBe(0);
    });
});

// Equal initial interest does not prove divergence when rates differ.
describe('rounded interest and changing rate mix', () => {
  it('allows focus payments to reduce future interest when the initial budget equals interest', () => {
    const values = { debts: [{ name: 'a', balance: 100, apr: 120, minPayment: 11 }, { name: 'b', balance: 100, apr: 60, minPayment: 4 }], strategy: 'avalanche' as const, extraMonthly: 0, lumpSum: 0 };
    expect(buildDebtScenario(values).plan).toMatchObject({ months: 40, totalInterest: 387.15 });
    expect(solveDebtExtra(values, 60)).toEqual({ status: 'solved', extraMonthly: 0 });
  });
  it('uses per-account rounded interest for tiny balances', () => {
    const values = { debts: [{ name: 'a', balance: .1, apr: 40, minPayment: 0 }, { name: 'b', balance: .1, apr: 40, minPayment: 0 }], strategy: 'avalanche' as const, extraMonthly: .01, lumpSum: 0 };
    expect(buildDebtScenario(values).plan).toMatchObject({ months: 20, totalInterest: 0 });
    expect(solveDebtExtra(values, 20)).toEqual({ status: 'solved', extraMonthly: .01 });
  });
});

it('rejects malformed or unknown ISO currencies without manufacturing USD', () => {
  const data = buildDebtPlannerData([{id:'x',name:'Unknown',balance:100,apr:0,currency:'ZZZ'},{id:'y',name:'Unknown',balance:100,apr:0,currency:'XXX'}], 0);
  expect(data.currency).toBeNull();
  expect(data.unknownCurrencyCount).toBe(2);
});
