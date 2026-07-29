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
  // Save Up Category (2 items)
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
    id: "sinking-funds",
    version: 1,
    category: "save_up",
    title: "Establish Sinking Funds for Known Expenses",
    body: "Set aside small monthly amounts for annual expenses like car insurance, property tax, and holiday gifts.",
    tasks: [
      { id: "task-sf-1", label: "List all non-monthly recurring expenses for the year" },
      { id: "task-sf-2", label: "Divide total annual cost by 12" },
      { id: "task-sf-3", label: "Automate monthly savings into non-monthly budget envelopes" },
    ],
    sources: [
      {
        title: "CFPB Savings Rules of Thumb",
        url: "https://www.consumerfinance.gov/consumer-tools/save/",
        reviewedAt: "2026-07-01",
      },
    ],
  },

  // Spend Category (2 items)
  {
    id: "subscription-audit",
    version: 1,
    category: "spend",
    title: "Audit Monthly Recurring Subscriptions",
    body: "Review recurring streaming, software, and membership charges to eliminate unused subscriptions.",
    tasks: [
      { id: "task-sub-1", label: "Review Recurring Streams tab for unreviewed merchants" },
      { id: "task-sub-2", label: "Cancel subscriptions not used in the last 30 days" },
    ],
    sources: [
      {
        title: "FTC Subscription Audit",
        url: "https://consumer.ftc.gov/articles/canceling-subscriptions",
        reviewedAt: "2026-07-01",
      },
    ],
  },
  {
    id: "50-30-20-budget",
    version: 1,
    category: "spend",
    title: "Apply the 50/30/20 Budget Framework",
    body: "Allocate 50% of income to Needs, 30% to Wants, and 20% to Savings and Debt payoff.",
    tasks: [
      { id: "task-503020-1", label: "Group monthly budget into Needs, Wants, and Savings" },
      { id: "task-503020-2", label: "Adjust flexible spending envelopes to align with targets" },
    ],
    sources: [
      {
        title: "CFPB Budgeting Strategies",
        url: "https://www.consumerfinance.gov/about-us/blog/budgeting-strategies/",
        reviewedAt: "2026-07-01",
      },
    ],
  },

  // Pay Down Category (2 items)
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
  {
    id: "student-loan-payoff",
    version: 1,
    category: "pay_down",
    title: "Optimize Student Loan Repayment",
    body: "Evaluate income-driven repayment options or refinancing opportunities for federal and private student loans.",
    tasks: [
      { id: "task-sl-1", label: "Review current interest rates and repayment plans" },
      { id: "task-sl-2", label: "Check eligibility for Public Service Loan Forgiveness or IDR" },
    ],
    sources: [
      {
        title: "Federal Student Aid Repayment Guide",
        url: "https://studentaid.gov/manage-loans/repayment",
        reviewedAt: "2026-07-01",
      },
    ],
  },

  // Protect Category (2 items)
  {
    id: "insurance-checkup",
    version: 1,
    category: "protect",
    title: "Conduct an Annual Insurance Checkup",
    body: "Ensure sufficient coverage across health, auto, renters/homeowners, and disability insurance policies.",
    tasks: [
      { id: "task-ins-1", label: "Verify auto and renters policy liability limits" },
      { id: "task-ins-2", label: "Shop quotes annually to compare policy premiums" },
    ],
    sources: [
      {
        title: "NAIC Insurance Basics",
        url: "https://content.naic.org/consumer.htm",
        reviewedAt: "2026-07-01",
      },
    ],
  },
  {
    id: "credit-report-freeze",
    version: 1,
    category: "protect",
    title: "Freeze Credit Reports Across Bureaus",
    body: "Protect yourself from identity theft by placing a free credit freeze with Equifax, Experian, and TransUnion.",
    tasks: [
      { id: "task-freeze-1", label: "Place a security freeze at Equifax, Experian, and TransUnion" },
      { id: "task-freeze-2", label: "Order free annual credit report to inspect inquiry log" },
    ],
    sources: [
      {
        title: "FTC Credit Freeze Guide",
        url: "https://consumer.ftc.gov/articles/what-know-about-credit-freezes-and-fraud-alerts",
        reviewedAt: "2026-07-01",
      },
    ],
  },

  // Invest Category (2 items)
  {
    id: "employer-match",
    version: 1,
    category: "invest",
    title: "Capture Full Employer 401(k) Match",
    body: "Contribute enough to your workplace 401(k) or 403(b) to claim 100% of the employer matching contribution.",
    tasks: [
      { id: "task-match-1", label: "Check company match formula in HR benefits portal" },
      { id: "task-match-2", label: "Set payroll contribution percentage to meet or exceed match" },
    ],
    sources: [
      {
        title: "DOL Retirement Planning Guide",
        url: "https://www.dol.gov/agencies/ebsa/workers-and-families/preparing-for-retirement",
        reviewedAt: "2026-07-01",
      },
    ],
  },
  {
    id: "roth-ira-funding",
    version: 1,
    category: "invest",
    title: "Max Out Annual Roth IRA Contributions",
    body: "Invest in low-cost index funds within a Roth IRA for tax-free growth and tax-free retirement withdrawals.",
    tasks: [
      { id: "task-roth-1", label: "Verify MAGI income eligibility for Roth IRA contributions" },
      { id: "task-roth-2", label: "Set up monthly automatic deposit into IRA account" },
    ],
    sources: [
      {
        title: "IRS IRA Contribution Limits",
        url: "https://www.irs.gov/retirement-plans/individual-retirement-arrangements-iras",
        reviewedAt: "2026-07-01",
      },
    ],
  },

  // Wellness Category (2 items)
  {
    id: "financial-check-in",
    version: 1,
    category: "wellness",
    title: "Schedule Monthly Financial Check-in",
    body: "Dedicate 20 minutes at month-end to review transactions, update budget targets, and track net worth growth.",
    tasks: [
      { id: "task-well-1", label: "Calendar monthly financial review for the last Sunday of the month" },
      { id: "task-well-2", label: "Review net worth progress and account balances" },
    ],
    sources: [
      {
        title: "CFPB Financial Well-Being Assessment",
        url: "https://www.consumerfinance.gov/consumer-tools/financial-well-being/",
        reviewedAt: "2026-07-01",
      },
    ],
  },
  {
    id: "beneficiary-audit",
    version: 1,
    category: "wellness",
    title: "Update Estate & Account Beneficiaries",
    body: "Ensure primary and contingent beneficiaries are up to date on all bank accounts, IRAs, and life insurance.",
    tasks: [
      { id: "task-ben-1", label: "Log into bank and brokerage accounts to verify beneficiary designations" },
      { id: "task-ben-2", label: "Add Payable on Death (POD) transfer tags where supported" },
    ],
    sources: [
      {
        title: "FINRA Managing Accounts & Beneficiaries",
        url: "https://www.finra.org/investors/learn-to-invest/types-accounts",
        reviewedAt: "2026-07-01",
      },
    ],
  },
];
