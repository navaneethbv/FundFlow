import { buildPayoffSchedule, type PayoffPlanInput, type ScheduledPayoffPlan } from '@/lib/debt';
export const MAX_DEBT_MONEY = 1000000000;
export const MAX_DEBT_APR = 1000;
export type DebtScenarioInput = PayoffPlanInput & {
    lumpSum: number;
};
const cents = (value: number) => Math.round(value * 100) / 100;
function bounded(value: number, maximum: number) {
    if (!Number.isFinite(value) || value < 0 || value > maximum)
        throw new Error('Enter a finite nonnegative value within the displayed limits.');
}
function validate(input: DebtScenarioInput) {
    if (input.debts.length > 100)
        throw new Error("Scenario planning supports up to 100 debt accounts. Narrow the account scope to continue.");
    bounded(input.lumpSum, MAX_DEBT_MONEY);
    bounded(input.extraMonthly, MAX_DEBT_MONEY);
    if (!['avalanche', 'snowball'].includes(input.strategy))
        throw new Error('Choose a payoff strategy.');
    if (new Set(input.debts.map(debt => debt.name)).size !== input.debts.length)
        throw new Error('Debt account IDs must be unique.');
    for (const debt of input.debts) {
        bounded(debt.balance, MAX_DEBT_MONEY);
        bounded(debt.apr, MAX_DEBT_APR);
        if (debt.minPayment !== undefined)
            bounded(debt.minPayment, MAX_DEBT_MONEY);
    }
}
function simulate(input: PayoffPlanInput): ScheduledPayoffPlan | null {
    return input.debts.length ? buildPayoffSchedule(input) : { months: 0, totalInterest: 0, order: [], debts: [], schedule: [] };
}
/** Fix minimums before applying the immediate payment, preserving rollover budget. */
export function buildDebtScenario(input: DebtScenarioInput) {
    validate(input);
    const debts = input.debts.map(debt => ({ ...debt, balance: cents(debt.balance), minPayment: cents(debt.minPayment ?? Math.max(25, debt.balance * .02)) }));
    const baseline = simulate({ ...input, debts });
    const remainingDebts = [...debts].sort((a, b) => input.strategy === 'avalanche' ? b.apr - a.apr : a.balance - b.balance);
    let available = cents(input.lumpSum);
    for (const debt of remainingDebts) {
        const applied = Math.min(available, debt.balance);
        debt.balance = cents(debt.balance - applied);
        available = cents(available - applied);
    }
    const plan = simulate({ ...input, debts: remainingDebts });
    return { baseline, plan, remainingDebts, appliedLumpSum: cents(input.lumpSum - available), interestSaved: baseline && plan ? cents(baseline.totalInterest - plan.totalInterest) : null, monthsSaved: baseline && plan ? baseline.months - plan.months : null };
}
export function solveDebtExtra(input: DebtScenarioInput, targetMonths: number, maxExtra = MAX_DEBT_MONEY): {
    status: 'solved';
    extraMonthly: number;
} | {
    status: 'unattainable';
} {
    validate(input);
    bounded(maxExtra, MAX_DEBT_MONEY);
    if (!Number.isInteger(targetMonths) || targetMonths < 1 || targetMonths > 600)
        throw new Error('Payoff horizon must be a whole number from 1 to 600 months.');
    const meets = (amount: number) => { const plan = buildDebtScenario({ ...input, extraMonthly: amount }).plan; return plan !== null && plan.months <= targetMonths; };
    let low = 0, high = Math.floor(maxExtra * 100);
    if (!meets(high / 100))
        return { status: 'unattainable' };
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (meets(mid / 100))
            high = mid;
        else
            low = mid + 1;
    }
    return { status: 'solved', extraMonthly: low / 100 };
}
export function debtPaymentLadder(input: DebtScenarioInput) {
    validate(input);
    return [0, 25, 50, 100, 250].map(increment => { const extraMonthly = Math.min(MAX_DEBT_MONEY, cents(input.extraMonthly + increment)); return { extraMonthly, plan: buildDebtScenario({ ...input, extraMonthly }).plan }; });
}
