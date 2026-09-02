/**
 * FIRE (Financial Independence, Retire Early) & Life-Event Simulation Engine.
 * Calculates FIRE targets, projected time-to-FI, savings rates, and incorporates
 * scheduled life event milestones (windfalls, home purchase, college, sabbaticals).
 */

export interface LifeEvent {
  id: string;
  name: string;
  monthOffset: number; // e.g. 12 = 1 year from now
  oneTimeCashFlow: number; // positive for windfalls, negative for down payments
  ongoingMonthlySpendDelta?: number; // e.g. +400 for child care, -800 for debt payoff
}

export interface FireSimulatorInput {
  currentNetWorth: number;
  monthlyIncome: number;
  monthlySpend: number;
  monthlySavings: number;
  annualReturnPct?: number; // e.g. 7.0 for 7%
  withdrawalRatePct?: number; // e.g. 4.0 for 4% rule
  currentAge?: number; // default 30
  lifeEvents?: LifeEvent[];
  projectionHorizonMonths?: number; // default 240 (20 years)
}

export interface FireMilestones {
  leanFireTarget: number; // 75% of current spend
  standardFireTarget: number; // 100% of current spend (25x annual)
  fatFireTarget: number; // 150% of current spend
  coastFireTarget: number; // amount needed now to reach FI at 65 without saving more
}

export interface FireTimelinePoint {
  monthIndex: number;
  age: number;
  netWorthBase: number;
  netWorthWithEvents: number;
  fireTarget: number;
}

export interface FireSimulationResult {
  milestones: FireMilestones;
  currentProgressPct: number;
  savingsRatePct: number;
  monthsToStandardFire: number | null;
  projectedFireAge: number | null;
  timeline: FireTimelinePoint[];
}

function round2(num: number): number {
  return Math.round(num * 100) / 100;
}

/**
 * Calculates core FIRE milestones, time to independence, and life event projections.
 */
export function calculateFireSimulation(input: FireSimulatorInput): FireSimulationResult {
  const annualReturn = (input.annualReturnPct ?? 7.0) / 100;
  const monthlyReturn = annualReturn / 12;
  const swr = (input.withdrawalRatePct ?? 4.0) / 100;
  const currentAge = input.currentAge ?? 30;
  const horizon = input.projectionHorizonMonths ?? 240; // 20 years

  const annualSpend = input.monthlySpend * 12;
  const standardFireTarget = round2(annualSpend / swr);
  const leanFireTarget = round2((annualSpend * 0.75) / swr);
  const fatFireTarget = round2((annualSpend * 1.5) / swr);

  // Coast FIRE: capital required today that compounds to FIRE target by age 65
  const yearsTo65 = Math.max(0, 65 - currentAge);
  const coastFireTarget = round2(
    yearsTo65 > 0 ? standardFireTarget / Math.pow(1 + annualReturn, yearsTo65) : standardFireTarget,
  );

  const milestones: FireMilestones = {
    leanFireTarget,
    standardFireTarget,
    fatFireTarget,
    coastFireTarget,
  };

  const savingsRatePct =
    input.monthlyIncome > 0
      ? round2(Math.min(100, Math.max(0, (input.monthlySavings / input.monthlyIncome) * 100)))
      : 0;

  const currentProgressPct =
    standardFireTarget > 0
      ? round2(Math.min(100, Math.max(0, (input.currentNetWorth / standardFireTarget) * 100)))
      : 0;

  // Simulate month by month
  let netWorthBase = Math.max(0, input.currentNetWorth);
  let netWorthWithEvents = Math.max(0, input.currentNetWorth);
  let currentMonthlySpend = input.monthlySpend;

  const timeline: FireTimelinePoint[] = [];
  let monthsToStandardFire: number | null = null;

  const eventsByMonth = new Map<number, LifeEvent[]>();
  for (const ev of input.lifeEvents || []) {
    const existing = eventsByMonth.get(ev.monthOffset) || [];
    existing.push(ev);
    eventsByMonth.set(ev.monthOffset, existing);
  }

  for (let m = 0; m <= horizon; m++) {
    const age = round2(currentAge + m / 12);
    const dynamicFireTarget = round2((currentMonthlySpend * 12) / swr);

    timeline.push({
      monthIndex: m,
      age,
      netWorthBase: round2(netWorthBase),
      netWorthWithEvents: round2(netWorthWithEvents),
      fireTarget: dynamicFireTarget,
    });

    if (monthsToStandardFire === null && netWorthWithEvents >= dynamicFireTarget) {
      monthsToStandardFire = m;
    }

    // Step next month:
    // 1. Compound existing wealth
    netWorthBase = netWorthBase * (1 + monthlyReturn) + input.monthlySavings;
    netWorthWithEvents = netWorthWithEvents * (1 + monthlyReturn) + input.monthlySavings;

    // 2. Apply scheduled life events for next month
    const scheduled = eventsByMonth.get(m + 1);
    if (scheduled) {
      for (const ev of scheduled) {
        netWorthWithEvents += ev.oneTimeCashFlow;
        if (ev.ongoingMonthlySpendDelta) {
          currentMonthlySpend = Math.max(0, currentMonthlySpend + ev.ongoingMonthlySpendDelta);
        }
      }
    }
  }

  const projectedFireAge =
    monthsToStandardFire !== null ? round2(currentAge + monthsToStandardFire / 12) : null;

  return {
    milestones,
    currentProgressPct,
    savingsRatePct,
    monthsToStandardFire,
    projectedFireAge,
    timeline,
  };
}
