/** Read-only savings arithmetic. All calculations use integer cents and calendar dates. */
export type GoalCadence = "weekly" | "biweekly" | "monthly";
export interface ScenarioGoal { id: string; name: string; targetAmount: number; fundedAmount: number; targetDate: string | null }
export interface GoalScenarioInput {
  targetAmount: number; fundedAmount: number; contributionAmount: number; lumpSum: number;
  cadence: GoalCadence; skipPayments: number; today: string; deadline: string | null;
}
export const GOAL_SCENARIO_MAX_AMOUNT = 1_000_000_000;
export const GOAL_SCENARIO_MAX_DATES = 600;
function cents(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > GOAL_SCENARIO_MAX_AMOUNT) throw new Error("Enter amounts from 0 to 1,000,000,000 USD.");
  const rounded = Math.round(value * 100);
  if (Math.abs(value * 100 - rounded) > 0.00001) throw new Error("Enter amounts with no more than two decimal places.");
  return rounded;
}
function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a valid calendar date.");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Enter a valid calendar date.");
  return date;
}
function paymentDate(today: Date, cadence: GoalCadence, index: number): string {
  const date = new Date(today);
  if (cadence === "monthly") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + index);
    const last = new Date(date);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(today.getUTCDate(), last.getUTCDate()));
  } else date.setUTCDate(date.getUTCDate() + index * (cadence === "weekly" ? 7 : 14));
  return date.toISOString().slice(0, 10);
}
function completionStatus(remaining: number, contribution: number, date: string | null) {
  if (remaining === 0) return "complete";
  if (contribution === 0) return "no-contributions";
  return date ? "projected" : "beyond-horizon";
}
function milestoneStatus(amount: number, funded: number, starting: number, date: string | null) {
  if (amount <= funded) return "already-reached";
  if (amount <= starting) return "lump-sum";
  return date ? "projected" : "unreached";
}
function deadlineStatus(deadline: string, today: string, horizon: string, remaining: number, payments: number) {
  if (deadline < today) return "past";
  if (remaining === 0) return "available";
  if (deadline > horizon) return "beyond-horizon";
  return payments === 0 ? "no-payments" : "available";
}
function deadlineRequirement(deadline: string | null, today: string, horizon: string, dates: string[], remaining: number, contribution: number) {
  if (deadline === null) return null;
  const payments = dates.filter(date => date <= deadline).length;
  const status = deadlineStatus(deadline, today, horizon, remaining, payments);
  if (status !== "available") return { status, payments, requiredAmount: null, gapAmount: null };
  const required = remaining === 0 ? 0 : Math.ceil(remaining / payments);
  return { status, payments, requiredAmount: required / 100, gapAmount: (required - contribution) / 100 };
}
export function calculateGoalScenario(input: GoalScenarioInput) {
  const target = cents(input.targetAmount), funded = cents(input.fundedAmount);
  const contribution = cents(input.contributionAmount), lumpSum = cents(input.lumpSum);
  const today = parseDate(input.today);
  // A monthly 600-date horizon needs another 50 representable calendar years.
  if (input.today > "9949-12-31") throw new Error("Scenario start dates must be on or before 9949-12-31.");
  if (input.deadline !== null) parseDate(input.deadline);
  if (!["weekly", "biweekly", "monthly"].includes(input.cadence)) throw new Error("Choose a supported contribution cadence.");
  if (!Number.isInteger(input.skipPayments) || input.skipPayments < 0 || input.skipPayments > 120) throw new Error("Skip between 0 and 120 whole contributions.");
  const allDates = Array.from({ length: GOAL_SCENARIO_MAX_DATES }, (_, i) => paymentDate(today, input.cadence, i + 1));
  const paymentDates = allDates.slice(input.skipPayments);
  const starting = Math.min(target, funded + lumpSum);
  const remaining = Math.max(0, target - starting);
  const dateFor = (amount: number) => {
    if (amount <= starting) return input.today;
    if (contribution === 0) return null;
    return paymentDates.at(Math.ceil((amount - starting) / contribution) - 1) ?? null;
  };
  const completionDate = dateFor(target);
  const milestones = [25, 50, 75, 100].map(percent => {
    const amount = Math.ceil(target * percent / 100);
    const date = dateFor(amount);
    return { percent, amount: amount / 100, date, status: milestoneStatus(amount, funded, starting, date) };
  });
  const horizonDate = allDates.at(-1)!;
  return {
    paymentDates, horizonDate, completionDate,
    completionStatus: completionStatus(remaining, contribution, completionDate), milestones,
    deadline: deadlineRequirement(input.deadline, input.today, horizonDate, paymentDates, remaining, contribution),
    remainingAmount: remaining / 100,
    appliedLumpSum: Math.min(lumpSum, Math.max(0, target - funded)) / 100,
  };
}
