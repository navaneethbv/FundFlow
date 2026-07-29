export type AdviceCategory = "save_up" | "spend" | "pay_down" | "protect" | "invest" | "wellness";

export interface AdviceItem {
  id: string;
  version: number;
  category: AdviceCategory;
  title: string;
  body: string;
  tasks: { id: string; label: string }[];
  sources: { title: string; url: string; reviewedAt: string }[];
}

export const ADVICE_LIBRARY: AdviceItem[] = [
  {
    id: "emergency-fund",
    version: 1,
    category: "save_up",
    title: "Build 3-6 Months of Emergency Savings",
    body: "An emergency fund protects your financial stability against unexpected job loss or medical expenses.",
    tasks: [
      { id: "task-ef-1", label: "Calculate 3 months of essential expenses" },
      { id: "task-ef-2", label: "Open a dedicated High-Yield Savings Account (HYSA)" },
      { id: "task-ef-3", label: "Set up recurring monthly transfers" },
    ],
    sources: [
      {
        title: "CFPB Emergency Savings Guide",
        url: "https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/",
        reviewedAt: "2026-07-01",
      },
    ],
  },
  {
    id: "avalanche-debt",
    version: 1,
    category: "pay_down",
    title: "Tackle High-Interest Credit Debt",
    body: "Prioritize credit cards and loans with interest rates over 10% using the Debt Avalanche method.",
    tasks: [
      { id: "task-debt-1", label: "List all credit card balances and APRs" },
      { id: "task-debt-2", label: "Set up automatic minimum payments on all cards" },
      { id: "task-debt-3", label: "Direct surplus cash to the highest APR card" },
    ],
    sources: [
      {
        title: "FTC Coping with Debt",
        url: "https://consumer.ftc.gov/articles/coping-debt",
        reviewedAt: "2026-07-01",
      },
    ],
  },
];
