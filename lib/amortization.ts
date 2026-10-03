import { addMonths, parseDate, isoDate } from "@/lib/date-utils";

export type PaymentStrategy = "reamortize" | "hold";

export interface AmortizationRatePeriod {
  /** First payment date at which this annual rate is used. */
  start: string;
  annualRate: number;
  /** Recalculate the scheduled payment, or keep the prior payment. */
  strategy?: PaymentStrategy;
}

export interface AmortizationExtraPayment {
  date: string;
  amount: number;
}

export interface AmortizationInput {
  principal: number;
  startDate: string;
  /** Scheduled payment before any rate-period reamortization. */
  paymentAmount: number;
  /** Number of months used when a rate period reamortizes. Defaults to 360. */
  termMonths?: number;
  ratePeriods: AmortizationRatePeriod[];
  extraPayments?: AmortizationExtraPayment[];
  /** Refuse if the loan is not paid by this many scheduled periods. */
  periodCap?: number;
  /** Calendar day for each payment. It is clamped in short months. */
  paymentDay?: number;
}

export interface AmortizationRow {
  period: number;
  date: string;
  openingPrincipal: number;
  annualRate: number;
  interest: number;
  scheduledPayment: number;
  extraPayment: number;
  closingPrincipal: number;
}

export interface AmortizationResult {
  rows: AmortizationRow[];
  totalInterest: number;
  totalPayments: number;
  payoffDate: string;
}

const EPSILON = 0.005;
const DEFAULT_TERM_MONTHS = 360;
const DEFAULT_PERIOD_CAP = 1200;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parseDate(value).getTime())) {
    throw new Error(`${field} must be an ISO date`);
  }
}

function paymentDate(startDate: string, period: number, paymentDay?: number): string {
  const candidate = addMonths(startDate, period);
  if (!paymentDay) return candidate;
  const parsed = parseDate(candidate);
  const monthEnd = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  parsed.setUTCDate(Math.min(Math.max(1, Math.floor(paymentDay)), monthEnd));
  return isoDate(parsed);
}

function monthlyPayment(principal: number, annualRate: number, months: number): number {
  if (principal <= EPSILON) return 0;
  if (months <= 0) return round2(principal);
  const monthlyRate = annualRate / 100 / 12;
  if (Math.abs(monthlyRate) < Number.EPSILON) return round2(principal / months);
  const factor = Math.pow(1 + monthlyRate, months);
  return round2((principal * monthlyRate * factor) / (factor - 1));
}

function activeRatePeriod(periods: AmortizationRatePeriod[], date: string): AmortizationRatePeriod {
  let active = periods[0]!;
  for (const period of periods) {
    if (period.start <= date) active = period;
    else break;
  }
  return active;
}

function extrasOnDate(extras: AmortizationExtraPayment[], date: string): number {
  return round2(extras.filter((extra) => extra.date === date).reduce((sum, extra) => sum + extra.amount, 0));
}

/**
 * Build a calendar-month amortization schedule from user-supplied rates and
 * extra payments. The function is deliberately pure so the debt page and unit
 * tests share the same financial calculation without database or clock input.
 */
/** One month: interest accrues, the scheduled payment applies, then any extra. */
function amortizePeriod(openingPrincipal: number, annualRate: number, scheduledPayment: number, extras: number) {
  const interest = round2(openingPrincipal * (annualRate / 100 / 12));
  const required = round2(openingPrincipal + interest);
  const payment = Math.min(scheduledPayment, required);
  const afterScheduled = round2(required - payment);
  if (afterScheduled > openingPrincipal - EPSILON && extras <= EPSILON && payment <= interest + EPSILON) {
    throw new Error("AMORTIZATION_NON_AMORTIZING");
  }
  const extraPayment = Math.min(extras, afterScheduled);
  return { interest, payment, extraPayment, closing: round2(Math.max(0, afterScheduled - extraPayment)) };
}

function validatedInputs(input: AmortizationInput) {
  if (!Number.isFinite(input.principal) || input.principal < 0) throw new Error("principal must be non-negative");
  if (!Number.isFinite(input.paymentAmount) || input.paymentAmount <= 0) throw new Error("paymentAmount must be positive");
  assertDate(input.startDate, "startDate");
  if (input.ratePeriods.length === 0) throw new Error("at least one rate period is required");
  const periods = [...input.ratePeriods].sort((a, b) => a.start.localeCompare(b.start));
  periods.forEach((period) => {
    assertDate(period.start, "rate period start");
    if (!Number.isFinite(period.annualRate) || period.annualRate < 0) throw new Error("annualRate must be non-negative");
  });
  const extras = [...(input.extraPayments ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  extras.forEach((extra) => {
    assertDate(extra.date, "extra payment date");
    if (!Number.isFinite(extra.amount) || extra.amount < 0) throw new Error("extra payment amount must be non-negative");
  });
  return { periods, extras };
}

export function buildAmortizationSchedule(input: AmortizationInput): AmortizationResult {
  const { periods, extras } = validatedInputs(input);
  const termMonths = Math.max(1, Math.floor(input.termMonths ?? DEFAULT_TERM_MONTHS));
  const periodCap = Math.max(1, Math.floor(input.periodCap ?? DEFAULT_PERIOD_CAP));
  let balance = round2(input.principal);
  if (balance <= EPSILON) {
    return { rows: [], totalInterest: 0, totalPayments: 0, payoffDate: input.startDate };
  }

  const rows: AmortizationRow[] = [];
  let scheduledPayment = round2(input.paymentAmount);
  let totalInterest = 0;
  let totalPayments = 0;
  let previousPeriodStart = periods[0]!.start;

  for (let period = 1; period <= periodCap; period += 1) {
    const date = paymentDate(input.startDate, period - 1, input.paymentDay);
    const ratePeriod = activeRatePeriod(periods, date);
    const rateChanged = ratePeriod.start !== previousPeriodStart;
    if (rateChanged && (ratePeriod.strategy ?? "reamortize") === "reamortize") {
      const remainingMonths = Math.max(1, termMonths - (period - 1));
      scheduledPayment = monthlyPayment(balance, ratePeriod.annualRate, remainingMonths);
    }
    previousPeriodStart = ratePeriod.start;

    const openingPrincipal = balance;
    const { interest, payment, extraPayment, closing } = amortizePeriod(openingPrincipal, ratePeriod.annualRate, scheduledPayment, extrasOnDate(extras, date));
    balance = closing;
    totalInterest = round2(totalInterest + interest);
    totalPayments = round2(totalPayments + payment + extraPayment);
    rows.push({
      period,
      date,
      openingPrincipal,
      annualRate: ratePeriod.annualRate,
      interest,
      scheduledPayment: round2(payment),
      extraPayment,
      closingPrincipal: balance,
    });

    if (balance <= EPSILON) {
      return { rows, totalInterest, totalPayments, payoffDate: date };
    }
  }

  throw new Error("AMORTIZATION_PERIOD_CAP");
}

export function compareAmortizationInterest(
  input: AmortizationInput,
): { withExtras: AmortizationResult; withoutExtras: AmortizationResult; interestSaved: number } {
  const withExtras = buildAmortizationSchedule(input);
  const withoutExtras = buildAmortizationSchedule({ ...input, extraPayments: [] });
  return {
    withExtras,
    withoutExtras,
    interestSaved: round2(Math.max(0, withoutExtras.totalInterest - withExtras.totalInterest)),
  };
}
