import { CanonicalFinanceTransaction } from "./finance-domain";
import { titleCase } from "./format";
import { SankeyNode, SankeyLink } from "./sankey";

export interface ReportSummary {
  totalTransactions: number;
  largest: number;
  averageAbsolute: number;
  totalIncome: number;
  totalSpending: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function summarizeTransactions(txns: CanonicalFinanceTransaction[]): ReportSummary {
  if (txns.length === 0) {
    return {
      totalTransactions: 0,
      largest: 0,
      averageAbsolute: 0,
      totalIncome: 0,
      totalSpending: 0,
      firstDate: null,
      lastDate: null,
    };
  }

  let totalIncome = 0;
  let totalSpending = 0;
  let absSum = 0;
  let largest = 0;

  for (const t of txns) {
    const absVal = Math.abs(t.signedAmount);
    absSum += absVal;
    if (absVal > largest) largest = absVal;

    if (t.flow === "income") totalIncome += absVal;
    if (t.flow === "expense") totalSpending += absVal;
  }

  return {
    totalTransactions: txns.length,
    largest: Math.round(largest * 100) / 100,
    averageAbsolute: Math.round((absSum / txns.length) * 100) / 100,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalSpending: Math.round(totalSpending * 100) / 100,
    firstDate: txns[0]?.date || null,
    lastDate: txns[txns.length - 1]?.date || null,
  };
}

export function buildCashFlowSankeyData(txns: CanonicalFinanceTransaction[]): {
  nodes: SankeyNode[];
  links: SankeyLink[];
} {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  let totalIncome = 0;
  let totalExpenses = 0;

  const groupExpenses = new Map<string, number>();

  for (const t of txns) {
    const absVal = Math.abs(t.signedAmount);
    if (t.flow === "income") {
      totalIncome += absVal;
    } else if (t.flow === "expense") {
      totalExpenses += absVal;
      const grp = t.groupKey || "OTHER";
      groupExpenses.set(grp, (groupExpenses.get(grp) || 0) + absVal);
    }
  }

  const incomeVal = Math.round(totalIncome * 100) / 100;
  const expenseVal = Math.round(totalExpenses * 100) / 100;

  // Column 0: Income source
  nodes.push({ id: "income-hub", label: "Income", value: incomeVal || 1, column: 0 });

  // Column 1: Cash flow hub
  nodes.push({ id: "cashflow-hub", label: "Total Cash Flow", value: Math.max(incomeVal, expenseVal) || 1, column: 1 });

  links.push({ source: "income-hub", target: "cashflow-hub", value: incomeVal || 1 });

  // Column 2: Expense groups
  for (const [grpKey, amount] of groupExpenses.entries()) {
    const roundedAmt = Math.round(amount * 100) / 100;
    const nodeId = `group-${grpKey}`;
    nodes.push({ id: nodeId, label: titleCase(grpKey), value: roundedAmt, column: 2 });
    links.push({ source: "cashflow-hub", target: nodeId, value: roundedAmt });
  }

  return { nodes, links };
}
