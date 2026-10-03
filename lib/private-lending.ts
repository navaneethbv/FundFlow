import { isoDate, parseDate } from "@/lib/date-utils";

export type PrivateLoanDirection = "lent" | "borrowed";

export interface PrivateLoanPayment {
  id: string;
  paymentDate: string;
  amount: number;
  note: string | null;
}

export interface PrivateLoan {
  id: string;
  direction: PrivateLoanDirection;
  counterparty: string;
  principal: number;
  annualInterestRate: number;
  startDate: string;
  dueDate: string | null;
  notes: string | null;
  status: "active" | "settled";
  payments: PrivateLoanPayment[];
}

export interface PrivateLoanBalance {
  principalOutstanding: number;
  accruedInterest: number;
  totalOutstanding: number;
  paidPrincipal: number;
  paidInterest: number;
}

export interface PrivateLoanView extends PrivateLoan {
  balance: PrivateLoanBalance;
}

export interface PrivateLendingSummary {
  receivable: number;
  payable: number;
  netWorthAdjustment: number;
}

function calendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDate(parseDate(value)) === value;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function daysBetween(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function accrue(principal: number, annualRate: number, days: number): number {
  return principal * (annualRate / 100) * (days / 365);
}

export function buildPrivateLoanBalance(loan: Pick<PrivateLoan, "principal" | "annualInterestRate" | "startDate" | "payments">, asOf: string): PrivateLoanBalance {
  let principal = Math.max(0, Number(loan.principal));
  let interest = 0;
  let paidPrincipal = 0;
  let paidInterest = 0;
  let cursor = loan.startDate;
  const payments = [...loan.payments]
    .filter((payment) => payment.paymentDate <= asOf)
    .toSorted((left, right) => left.paymentDate.localeCompare(right.paymentDate) || left.id.localeCompare(right.id));
  for (const payment of payments) {
    interest += accrue(principal, loan.annualInterestRate, daysBetween(cursor, payment.paymentDate));
    const amount = Math.max(0, Number(payment.amount));
    const interestPayment = Math.min(amount, interest);
    interest -= interestPayment;
    paidInterest += interestPayment;
    const principalPayment = Math.min(Math.max(0, amount - interestPayment), principal);
    principal -= principalPayment;
    paidPrincipal += principalPayment;
    cursor = payment.paymentDate;
  }
  interest += accrue(principal, loan.annualInterestRate, daysBetween(cursor, asOf));
  return {
    principalOutstanding: round2(principal),
    accruedInterest: round2(interest),
    totalOutstanding: round2(principal + interest),
    paidPrincipal: round2(paidPrincipal),
    paidInterest: round2(paidInterest),
  };
}

export function summarizePrivateLending(loans: PrivateLoanView[]): PrivateLendingSummary {
  let receivable = 0;
  let payable = 0;
  for (const loan of loans) {
    if (loan.direction === "lent") receivable += loan.balance.totalOutstanding;
    else payable += loan.balance.totalOutstanding;
  }
  return {
    receivable: round2(receivable),
    payable: round2(payable),
    netWorthAdjustment: round2(receivable - payable),
  };
}

export interface PrivateLoanDraft {
  direction: PrivateLoanDirection;
  counterparty: string;
  principal: number;
  annualInterestRate: number;
  startDate: string;
  dueDate: string | null;
  notes: string | null;
}

export function validatePrivateLoanDraft(value: unknown): { ok: true; value: PrivateLoanDraft } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Loan must be an object" };
  const input = value as Record<string, unknown>;
  if (input.direction !== "lent" && input.direction !== "borrowed") return { ok: false, error: "Direction must be lent or borrowed" };
  if (typeof input.counterparty !== "string" || input.counterparty.trim().length < 1 || input.counterparty.trim().length > 120) return { ok: false, error: "Counterparty must be 1 to 120 characters" };
  const principal = Number(input.principal);
  const annualInterestRate = Number(input.annualInterestRate ?? 0);
  if (!Number.isFinite(principal) || principal <= 0 || principal > 1_000_000_000) return { ok: false, error: "Principal must be positive and bounded" };
  if (!Number.isFinite(annualInterestRate) || annualInterestRate < 0 || annualInterestRate > 100) return { ok: false, error: "Interest rate must be between 0 and 100" };
  if (!calendarDate(input.startDate)) return { ok: false, error: "Start date must be YYYY-MM-DD" };
  const dueDate = input.dueDate === null || input.dueDate === undefined || input.dueDate === "" ? null : input.dueDate;
  if (dueDate !== null && (!calendarDate(dueDate) || dueDate < input.startDate)) return { ok: false, error: "Due date must be on or after the start date" };
  const notes = input.notes === null || input.notes === undefined || input.notes === "" ? null : input.notes;
  if (notes !== null && (typeof notes !== "string" || notes.length > 1000)) return { ok: false, error: "Notes must be at most 1000 characters" };
  return {
    ok: true,
    value: {
      direction: input.direction,
      counterparty: input.counterparty.trim(),
      principal: round2(principal),
      annualInterestRate: round2(annualInterestRate),
      startDate: input.startDate,
      dueDate: dueDate as string | null,
      notes: typeof notes === "string" ? notes.trim() || null : null,
    },
  };
}
