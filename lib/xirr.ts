/** Investor cash flows: contributions negative, withdrawals/terminal value positive. */
export interface DatedCashFlow { date: string; amount: number }
export type XirrResult = { rate: number; method: "newton" | "bisection"; multipleRootsPossible: boolean } | null;

export function validFinancialDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

type Term = { years: number; amount: number };
const MIN_RATE = -0.999999;
const MAX_RATE = 1e6;
const TOLERANCE = 1e-10;

function valueAt(terms: Term[], rate: number) {
  let value = 0, derivative = 0;
  for (const term of terms) {
    const discounted = term.amount / Math.pow(1 + rate, term.years);
    value += discounted;
    derivative -= term.years * discounted / (1 + rate);
  }
  return { value, derivative };
}

function newton(terms: Term[]): number | null {
  let rate = 0.1;
  for (let attempt = 0; attempt < 100; attempt++) {
    const { value, derivative } = valueAt(terms, rate);
    if (Math.abs(value) < TOLERANCE) return rate;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= MIN_RATE || next > MAX_RATE) return null;
    rate = next;
  }
  return null;
}

function bisect(terms: Term[], low: number, high: number): number | null {
  let lowValue = valueAt(terms, low).value;
  for (let attempt = 0; attempt < 200; attempt++) {
    const middle = (low + high) / 2;
    const value = valueAt(terms, middle).value;
    if (Math.abs(value) < TOLERANCE) return middle;
    if (Math.sign(value) === Math.sign(lowValue)) { low = middle; lowValue = value; }
    else high = middle;
  }
  return null;
}

function fallback(terms: Term[]): number | null {
  // Log-spaced brackets cover negative and large positive rates. Prefer the
  // bracket nearest the initial 10% guess. This is not an enumeration of roots.
  const points = [MIN_RATE, 0.1, MAX_RATE];
  for (let index = -120; index <= 120; index++) points.push(Math.exp(index / 10) - 1);
  points.sort((a, b) => a - b);
  const brackets: Array<[number, number]> = [];
  for (let index = 1; index < points.length; index++) {
    const low = points[index - 1], high = points[index];
    const a = valueAt(terms, low).value, b = valueAt(terms, high).value;
    if (Math.abs(a) < TOLERANCE) return low;
    if (Math.abs(b) < TOLERANCE) return high;
    if (Number.isFinite(a) && Number.isFinite(b) && Math.sign(a) !== Math.sign(b)) brackets.push([low, high]);
  }
  brackets.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - 0.1) - Math.abs((b[0] + b[1]) / 2 - 0.1));
  for (const [low, high] of brackets) {
    const root = bisect(terms, low, high);
    if (root !== null) return root;
  }
  return null;
}

/** Actual/365 annualization. Prefer Newton's root from 10%, then the nearest
 * sign-changing bracket. No claim of uniqueness for non-conventional flows. */
export function computeXirr(flows: readonly DatedCashFlow[]): XirrResult {
  if (flows.length < 2 || flows.length > 10000) return null;
  const byDate = new Map<string, number>();
  for (const flow of flows) {
    if (!validFinancialDate(flow.date) || !Number.isFinite(flow.amount)) return null;
    byDate.set(flow.date, (byDate.get(flow.date) ?? 0) + flow.amount);
  }
  const net = [...byDate].filter(([, amount]) => amount !== 0).sort(([a], [b]) => a.localeCompare(b));
  if (net.length < 2 || !net.some(([, a]) => a > 0) || !net.some(([, a]) => a < 0)) return null;
  const scale = net.reduce((sum, [, amount]) => sum + Math.abs(amount), 0);
  if (!Number.isFinite(scale)) return null;
  const start = Date.parse(net[0][0]);
  const terms = net.map(([date, amount]) => ({ years: (Date.parse(date) - start) / 86400000 / 365, amount: amount / scale }));
  const signChanges = net.slice(1).filter(([, amount], index) => Math.sign(amount) !== Math.sign(net[index][1])).length;
  const root = newton(terms);
  const rate = root ?? fallback(terms);
  return rate === null ? null : { rate, method: root === null ? "bisection" : "newton", multipleRootsPossible: signChanges > 1 };
}
