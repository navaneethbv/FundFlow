export interface RentBuyInputs {
  homePrice: number;
  downPayment: number;
  mortgageApr: number;
  termYears: number;
  propertyTaxMonthly: number;
  insuranceMonthly: number;
  maintenanceMonthly: number;
  closingCosts: number;
  monthlyRent: number;
  rentGrowthApr: number;
  homeAppreciationApr: number;
  horizonYears: number;
}

export interface RentBuyResult {
  monthlyMortgage: number;
  rentCostAtHorizon: number;
  buyNetCostAtHorizon: number;
  homeEquityAtHorizon: number;
  breakEvenMonth: number | null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function payment(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return principal / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return principal * monthlyRate * factor / (factor - 1);
}

function remainingPrincipal(principal: number, annualRate: number, termMonths: number, elapsedMonths: number, monthlyPayment: number): number {
  const elapsed = Math.min(termMonths, Math.max(0, elapsedMonths));
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return Math.max(0, principal - monthlyPayment * elapsed);
  const factor = Math.pow(1 + monthlyRate, elapsed);
  return Math.max(0, principal * factor - monthlyPayment * ((factor - 1) / monthlyRate));
}

export function calculateRentBuy(inputs: RentBuyInputs): RentBuyResult {
  const principal = Math.max(0, inputs.homePrice - inputs.downPayment);
  const termMonths = Math.max(1, Math.round(inputs.termYears * 12));
  const monthlyMortgage = payment(principal, inputs.mortgageApr, termMonths);
  const horizonMonths = Math.max(0, Math.round(inputs.horizonYears * 12));
  let rentTotal = 0;
  let buyTotal = Math.max(0, inputs.downPayment) + Math.max(0, inputs.closingCosts);
  let breakEvenMonth: number | null = null;
  let homeValue = Math.max(0, inputs.homePrice);
  for (let month = 1; month <= horizonMonths; month += 1) {
    const rent = Math.max(0, inputs.monthlyRent) * Math.pow(1 + inputs.rentGrowthApr / 100 / 12, month - 1);
    rentTotal += rent;
    const ongoing = Math.max(0, inputs.propertyTaxMonthly) + Math.max(0, inputs.insuranceMonthly) + Math.max(0, inputs.maintenanceMonthly);
    buyTotal += monthlyMortgage + ongoing;
    homeValue *= 1 + inputs.homeAppreciationApr / 100 / 12;
    const equity = Math.max(0, homeValue - remainingPrincipal(principal, inputs.mortgageApr, termMonths, month, monthlyMortgage));
    if (breakEvenMonth === null && buyTotal - equity <= rentTotal) breakEvenMonth = month;
  }
  const remaining = remainingPrincipal(principal, inputs.mortgageApr, termMonths, horizonMonths, monthlyMortgage);
  const equity = Math.max(0, homeValue - remaining);
  return {
    monthlyMortgage: round2(monthlyMortgage),
    rentCostAtHorizon: round2(rentTotal),
    buyNetCostAtHorizon: round2(buyTotal - equity),
    homeEquityAtHorizon: round2(equity),
    breakEvenMonth,
  };
}

export interface EmergencyFundInputs {
  essentialMonthlySpend: number;
  targetMonths: number;
  currentSavings: number;
}

export interface EmergencyFundResult {
  target: number;
  gap: number;
  monthsCovered: number;
}

export function calculateEmergencyFund(inputs: EmergencyFundInputs): EmergencyFundResult {
  const target = Math.max(0, inputs.essentialMonthlySpend) * Math.max(0, inputs.targetMonths);
  const currentSavings = Math.max(0, inputs.currentSavings);
  return {
    target: round2(target),
    gap: round2(Math.max(0, target - currentSavings)),
    monthsCovered: inputs.essentialMonthlySpend > 0 ? round2(currentSavings / inputs.essentialMonthlySpend) : 0,
  };
}

export interface CompoundInterestInputs {
  initial: number;
  monthlyContribution: number;
  annualReturn: number;
  years: number;
}

export interface CompoundInterestResult {
  futureValue: number;
  contributions: number;
  growth: number;
}

export function calculateCompoundInterest(inputs: CompoundInterestInputs): CompoundInterestResult {
  const months = Math.max(0, Math.round(inputs.years * 12));
  const monthlyRate = inputs.annualReturn / 100 / 12;
  let balance = Math.max(0, inputs.initial);
  let contributions = balance;
  for (let month = 0; month < months; month += 1) {
    balance *= 1 + monthlyRate;
    balance += Math.max(0, inputs.monthlyContribution);
    contributions += Math.max(0, inputs.monthlyContribution);
  }
  return { futureValue: round2(balance), contributions: round2(contributions), growth: round2(balance - contributions) };
}
