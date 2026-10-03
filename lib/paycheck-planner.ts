import { addDays } from "@/lib/date-utils";
import {
  paydayDates,
  validPaydayDate,
  type PaydaySettings,
} from "@/lib/payday";
export interface PaycheckBill {
  id: string;
  name: string;
  dueDate: string;
  amount: number;
}
export interface PlannedBill extends PaycheckBill {
  amount: number;
  funded: number;
}
export interface PayPeriod {
  start: string;
  end: string;
  income: number;
  due: number;
  reserved: number;
  fundedDue: number;
  remaining: number | null;
  shortfall: number | null;
  bridge: boolean;
  bills: PlannedBill[];
  reserves: PlannedBill[];
}
function cents(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1000000000000)
    throw new RangeError("Invalid planning amount");
  return Math.round(value * 100);
}
function allocateEarlier(
  periods: PayPeriod[],
  available: number[],
  bill: PaycheckBill,
  amount: number,
  home: number,
  remainder: number,
): number {
  const firstPay = periods[0]?.bridge ? 1 : 0;
  for (let source = home - 1; source >= firstPay && remainder > 0; source--) {
    const share =
      source === firstPay
        ? remainder
        : Math.min(remainder, Math.max(0, available[source]!));
    if (!share) continue;
    const earlier = periods[source]!;
    earlier.reserved += share;
    available[source]! -= share;
    remainder -= share;
    earlier.reserves.push({ ...bill, amount, funded: share });
  }
  return remainder;
}
function fundBill(
  periods: PayPeriod[],
  available: number[],
  bill: PaycheckBill,
  today: string,
): void {
  const amount = cents(bill.amount);
  const effectiveDate = bill.dueDate < today ? today : bill.dueDate;
  const home = periods.findIndex(
    (period) => effectiveDate >= period.start && effectiveDate <= period.end,
  );
  if (home < 0) return;
  const period = periods[home]!;
  period.due += amount;
  const ownShare = period.bridge
    ? amount
    : Math.min(amount, Math.max(0, available[home]!));
  const remainder = allocateEarlier(
    periods,
    available,
    bill,
    amount,
    home,
    amount - ownShare,
  );
  period.fundedDue += ownShare + remainder;
  available[home]! -= ownShare + remainder;
  period.bills.push({ ...bill, amount, funded: ownShare + remainder });
}
function inDollars(
  period: PayPeriod,
  available: number,
  cash: number | null,
): PayPeriod {
  let remaining: number | null = available;
  if (period.bridge)
    remaining = cash === null ? null : cents(cash) - period.due;
  const convert = (bill: PlannedBill) => ({
    ...bill,
    amount: bill.amount / 100,
    funded: bill.funded / 100,
  });
  return {
    ...period,
    income: period.income / 100,
    due: period.due / 100,
    reserved: period.reserved / 100,
    fundedDue: period.fundedDue / 100,
    remaining: remaining === null ? null : remaining / 100,
    shortfall: remaining === null ? null : Math.max(0, -remaining) / 100,
    bills: period.bills.map(convert),
    reserves: period.reserves.map(convert),
  };
}
/** Three declared pay periods, optionally preceded by a cash-funded bridge. */
export function planPaychecks(input: {
  today: string;
  settings: PaydaySettings;
  cash: number | null;
  bills: PaycheckBill[];
}): PayPeriod[] {
  const dates = paydayDates(input.settings, input.today);
  const bridge = input.today < dates[0]!;
  const starts = bridge ? [input.today, ...dates] : dates;
  const periods: PayPeriod[] = starts.slice(0, -1).map((start, index) => ({
    start,
    end: addDays(starts[index + 1]!, -1),
    income: bridge && index === 0 ? 0 : cents(input.settings.amount),
    due: 0,
    reserved: 0,
    fundedDue: 0,
    remaining: null,
    shortfall: null,
    bridge: bridge && index === 0,
    bills: [],
    reserves: [],
  }));
  const available = periods.map((period) => period.income);
  const ids = new Set<string>();
  for (const bill of [...input.bills].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
  )) {
    if (
      !validPaydayDate(bill.dueDate) ||
      !bill.id ||
      ids.has(bill.id) ||
      bill.amount <= 0
    )
      throw new RangeError("Invalid or duplicate bill");
    ids.add(bill.id);
    fundBill(periods, available, bill, input.today);
  }
  return periods.map((period, index) =>
    inDollars(period, available[index]!, input.cash),
  );
}
