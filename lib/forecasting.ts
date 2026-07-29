export interface ForecastAssumptions {
  monthlySavings: number;
  annualReturnPct: number;
  annualCashYieldPct: number;
  monthlyDebtPayment: number;
  horizonMonths: 12 | 60 | 120;
}

export interface ForecastPoint {
  month: string;
  conservative: number;
  base: number;
  optimistic: number;
}

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function forecastNetWorth(
  current: { cash: number; investments: number; liabilities: number },
  assumptions: ForecastAssumptions,
  startMonth: string = "2026-07",
): ForecastPoint[] {
  const { monthlySavings, annualReturnPct, horizonMonths } = assumptions;
  const points: ForecastPoint[] = [];

  let baseCash = Math.max(0, current.cash);
  let baseInv = Math.max(0, current.investments);
  let baseLiab = Math.max(0, current.liabilities);

  let consCash = baseCash;
  let consInv = baseInv;
  let consLiab = baseLiab;

  let optCash = baseCash;
  let optInv = baseInv;
  let optLiab = baseLiab;

  const baseMonthlyReturn = (annualReturnPct / 100) / 12;
  const consMonthlyReturn = Math.max(0, ((annualReturnPct - 3) / 100) / 12);
  const optMonthlyReturn = ((annualReturnPct + 3) / 100) / 12;

  for (let m = 1; m <= horizonMonths; m++) {
    const monthKey = addMonths(startMonth, m);

    // Base Scenario
    baseInv = baseInv * (1 + baseMonthlyReturn) + monthlySavings * 0.5;
    baseCash = baseCash + monthlySavings * 0.5;
    baseLiab = Math.max(0, baseLiab - assumptions.monthlyDebtPayment);

    // Conservative Scenario
    consInv = consInv * (1 + consMonthlyReturn) + monthlySavings * 0.4;
    consCash = consCash + monthlySavings * 0.4;
    consLiab = Math.max(0, consLiab - assumptions.monthlyDebtPayment * 0.8);

    // Optimistic Scenario
    optInv = optInv * (1 + optMonthlyReturn) + monthlySavings * 0.6;
    optCash = optCash + monthlySavings * 0.6;
    optLiab = Math.max(0, optLiab - assumptions.monthlyDebtPayment * 1.2);

    const baseNet = Math.round((baseCash + baseInv - baseLiab) * 100) / 100;
    const consNet = Math.round((consCash + consInv - consLiab) * 100) / 100;
    const optNet = Math.round((optCash + optInv - optLiab) * 100) / 100;

    points.push({
      month: monthKey,
      conservative: consNet,
      base: baseNet,
      optimistic: optNet,
    });
  }

  return points;
}
