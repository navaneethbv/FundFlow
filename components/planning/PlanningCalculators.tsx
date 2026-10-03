"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import { calculateCompoundInterest, calculateEmergencyFund, calculateRentBuy, type CompoundInterestInputs, type EmergencyFundInputs, type RentBuyInputs } from "@/lib/calculators";

function NumberField({ label, value, onChange, min = 0, step = "0.01" }: Readonly<{ label: string; value: number; onChange: (value: number) => void; min?: number; step?: string }>) {
  return <label className="grid gap-1 text-sm font-semibold"><span>{label}</span><input type="number" min={min} step={step} value={value} onChange={(event) => { onChange(Number(event.target.value)); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>;
}

export default function PlanningCalculators({ essentialMonthlySpend, currentSavings }: Readonly<{ essentialMonthlySpend: number; currentSavings: number }>) {
  const [rent, setRent] = useState<RentBuyInputs>({ homePrice: 400000, downPayment: 80000, mortgageApr: 6.5, termYears: 30, propertyTaxMonthly: 400, insuranceMonthly: 150, maintenanceMonthly: 300, closingCosts: 12000, monthlyRent: 2400, rentGrowthApr: 3, homeAppreciationApr: 3, horizonYears: 10 });
  const [rentResult, setRentResult] = useState(() => calculateRentBuy(rent));
  const [emergency, setEmergency] = useState<EmergencyFundInputs>({ essentialMonthlySpend, targetMonths: 6, currentSavings });
  const [emergencyResult, setEmergencyResult] = useState(() => calculateEmergencyFund(emergency));
  const [compound, setCompound] = useState<CompoundInterestInputs>({ initial: currentSavings, monthlyContribution: 500, annualReturn: 7, years: 20 });
  const [compoundResult, setCompoundResult] = useState(() => calculateCompoundInterest(compound));
  const updateRent = (key: keyof RentBuyInputs) => (value: number) => { setRent((current) => ({ ...current, [key]: value })); };
  const updateEmergency = (key: keyof EmergencyFundInputs) => (value: number) => { setEmergency((current) => ({ ...current, [key]: value })); };
  const updateCompound = (key: keyof CompoundInterestInputs) => (value: number) => { setCompound((current) => ({ ...current, [key]: value })); };
  return <div className="space-y-5">
    <Panel title="Rent versus buy" eyebrow="Editable assumptions">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField label="Home price" value={rent.homePrice} onChange={updateRent("homePrice")} />
        <NumberField label="Down payment" value={rent.downPayment} onChange={updateRent("downPayment")} />
        <NumberField label="Mortgage APR %" value={rent.mortgageApr} onChange={updateRent("mortgageApr")} />
        <NumberField label="Term (years)" value={rent.termYears} onChange={updateRent("termYears")} step="1" />
        <NumberField label="Property tax / month" value={rent.propertyTaxMonthly} onChange={updateRent("propertyTaxMonthly")} />
        <NumberField label="Insurance / month" value={rent.insuranceMonthly} onChange={updateRent("insuranceMonthly")} />
        <NumberField label="Maintenance / month" value={rent.maintenanceMonthly} onChange={updateRent("maintenanceMonthly")} />
        <NumberField label="Closing costs" value={rent.closingCosts} onChange={updateRent("closingCosts")} />
        <NumberField label="Monthly rent" value={rent.monthlyRent} onChange={updateRent("monthlyRent")} />
        <NumberField label="Rent growth %" value={rent.rentGrowthApr} onChange={updateRent("rentGrowthApr")} />
        <NumberField label="Home appreciation %" value={rent.homeAppreciationApr} onChange={updateRent("homeAppreciationApr")} />
        <NumberField label="Horizon (years)" value={rent.horizonYears} onChange={updateRent("horizonYears")} step="1" />
      </div>
      <Button type="button" className="mt-4" onClick={() => { setRentResult(calculateRentBuy(rent)); }}>Calculate rent versus buy</Button>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted">Mortgage / month</dt><dd data-money className="font-semibold">{formatCurrency(rentResult.monthlyMortgage)}</dd></div><div><dt className="text-muted">Rent cost at horizon</dt><dd data-money className="font-semibold">{formatCurrency(rentResult.rentCostAtHorizon)}</dd></div><div><dt className="text-muted">Buy net cost at horizon</dt><dd data-money className="font-semibold">{formatCurrency(rentResult.buyNetCostAtHorizon)}</dd></div><div><dt className="text-muted">Break-even</dt><dd className="font-semibold">{rentResult.breakEvenMonth ? `${rentResult.breakEvenMonth} months` : "Not reached"}</dd></div></dl>
      <p className="mt-3 text-xs text-muted">This is a scenario using your assumptions, not a prediction. It excludes taxes on sale and investment opportunity cost.</p>
    </Panel>
    <Panel title="Emergency fund" eyebrow="Seeded from essential spend">
      <p className="mb-3 text-sm text-muted">The starting essential-spend assumption is {formatCurrency(essentialMonthlySpend)} from your recent canonical expense history. You can edit every assumption.</p>
      <div className="grid gap-3 sm:grid-cols-3"><NumberField label="Essential spend / month" value={emergency.essentialMonthlySpend} onChange={updateEmergency("essentialMonthlySpend")} /><NumberField label="Target months" value={emergency.targetMonths} onChange={updateEmergency("targetMonths")} step="1" /><NumberField label="Current savings" value={emergency.currentSavings} onChange={updateEmergency("currentSavings")} /></div>
      <Button type="button" className="mt-4" onClick={() => { setEmergencyResult(calculateEmergencyFund(emergency)); }}>Calculate emergency fund</Button>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted">Target</dt><dd data-money className="font-semibold">{formatCurrency(emergencyResult.target)}</dd></div><div><dt className="text-muted">Remaining gap</dt><dd data-money className="font-semibold">{formatCurrency(emergencyResult.gap)}</dd></div><div><dt className="text-muted">Months covered</dt><dd className="font-semibold">{emergencyResult.monthsCovered.toFixed(1)}</dd></div></dl>
    </Panel>
    <Panel title="Compound interest" eyebrow="Editable assumptions">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><NumberField label="Starting amount" value={compound.initial} onChange={updateCompound("initial")} /><NumberField label="Monthly contribution" value={compound.monthlyContribution} onChange={updateCompound("monthlyContribution")} /><NumberField label="Annual return %" value={compound.annualReturn} onChange={updateCompound("annualReturn")} /><NumberField label="Years" value={compound.years} onChange={updateCompound("years")} step="1" /></div>
      <Button type="button" className="mt-4" onClick={() => { setCompoundResult(calculateCompoundInterest(compound)); }}>Calculate compound growth</Button>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted">Future value</dt><dd data-money className="font-semibold">{formatCurrency(compoundResult.futureValue)}</dd></div><div><dt className="text-muted">Contributions</dt><dd data-money className="font-semibold">{formatCurrency(compoundResult.contributions)}</dd></div><div><dt className="text-muted">Growth</dt><dd data-money className="font-semibold">{formatCurrency(compoundResult.growth)}</dd></div></dl>
      <p className="mt-3 text-xs text-muted">Returns are a user-entered scenario, compounded monthly. The result is labelled as a projection.</p>
    </Panel>
  </div>;
}
