export interface RecurringOccurrence {
  id: string;
  source: "plaid" | "manual";
  sourceId: string;
  merchant: string;
  frequency: string;
  dueDate: string;
  account: string | null;
  category: string | null;
  amount: number;
  status: "upcoming" | "overdue" | "complete";
  matchedTransactionId: string | null;
  isIncome: boolean;
  reviewed: boolean;
  dismissed: boolean;
}

export interface RecurringMonth {
  month: string;
  occurrences: RecurringOccurrence[];
  totals: {
    income: { paid: number; remaining: number };
    expenses: { paid: number; remaining: number };
    creditCards: { paid: number; remaining: number };
  };
  reviewCount: number;
}

export function expandStreamsForMonth(input: {
  streams: {
    id: string;
    merchant_name: string | null;
    description: string | null;
    average_amount: number;
    user_amount?: number | null;
    frequency: string;
    category: string | null;
    stream_type?: string | null;
    is_active?: boolean;
    predicted_next_date?: string | null;
    last_date?: string | null;
    reviewed_at?: string | null;
    dismissed_at?: string | null;
  }[];
  manualItems?: {
    id: string;
    merchant_name: string;
    amount: number;
    frequency: string;
    next_date: string;
    category?: string | null;
  }[];
  month: string;
  today: string;
}): RecurringMonth {
  const { streams, manualItems = [], month, today } = input;

  const occurrences: RecurringOccurrence[] = [];
  let reviewCount = 0;

  for (const s of streams) {
    if (s.is_active === false || s.dismissed_at) continue;

    if (!s.reviewed_at) {
      reviewCount += 1;
    }

    const merchant = s.merchant_name || s.description || "Recurring Stream";
    const amount = s.user_amount !== null && s.user_amount !== undefined ? Number(s.user_amount) : Number(s.average_amount);
    const isIncome = s.stream_type === "income" || amount < 0;
    const absAmount = Math.abs(amount);

    // Anchor due date to predicted_next_date or fallback to month's 15th
    const dueDate = s.predicted_next_date || `${month}-15`;
    const isPast = dueDate < today;
    const status = isPast ? "overdue" : "upcoming";

    occurrences.push({
      id: s.id,
      source: "plaid",
      sourceId: s.id,
      merchant,
      frequency: s.frequency || "MONTHLY",
      dueDate,
      account: null,
      category: s.category,
      amount: Math.round(absAmount * 100) / 100,
      status,
      matchedTransactionId: null,
      isIncome,
      reviewed: Boolean(s.reviewed_at),
      dismissed: Boolean(s.dismissed_at),
    });
  }

  for (const m of manualItems) {
    const isPast = m.next_date < today;
    occurrences.push({
      id: `manual-${m.id}`,
      source: "manual",
      sourceId: m.id,
      merchant: m.merchant_name,
      frequency: m.frequency,
      dueDate: m.next_date,
      account: null,
      category: m.category || null,
      amount: Math.round(Math.abs(m.amount) * 100) / 100,
      status: isPast ? "overdue" : "upcoming",
      matchedTransactionId: null,
      isIncome: m.amount < 0,
      reviewed: true,
      dismissed: false,
    });
  }

  occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  let incomePaid = 0;
  let incomeRemaining = 0;
  let expPaid = 0;
  let expRemaining = 0;
  const ccPaid = 0;
  const ccRemaining = 0;

  for (const o of occurrences) {
    if (o.isIncome) {
      if (o.status === "complete") incomePaid += o.amount;
      else incomeRemaining += o.amount;
    } else {
      if (o.status === "complete") expPaid += o.amount;
      else expRemaining += o.amount;
    }
  }

  return {
    month,
    occurrences,
    totals: {
      income: { paid: Math.round(incomePaid * 100) / 100, remaining: Math.round(incomeRemaining * 100) / 100 },
      expenses: { paid: Math.round(expPaid * 100) / 100, remaining: Math.round(expRemaining * 100) / 100 },
      creditCards: { paid: Math.round(ccPaid * 100) / 100, remaining: Math.round(ccRemaining * 100) / 100 },
    },
    reviewCount,
  };
}
