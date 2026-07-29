export interface ManualTxnInput {
  kind: "debit" | "credit";
  amount: number;
  merchant: string;
  date: string;
  account: { source: "plaid" | "manual"; id: string };
  category?: string | null;
  goal_id?: string | null;
  notes?: string | null;
}

export function normalizeManualTxn(input: ManualTxnInput) {
  if (!input.merchant || input.merchant.trim().length === 0) {
    throw new Error("Merchant name is required.");
  }

  if (isNaN(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be a positive number.");
  }

  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error("Invalid date format. Expected YYYY-MM-DD.");
  }

  const signedAmount = input.kind === "debit" ? Math.abs(input.amount) : -Math.abs(input.amount);
  const merchantClean = input.merchant.trim().slice(0, 120);

  return {
    kind: input.kind,
    amount: Math.round(signedAmount * 100) / 100,
    merchant: merchantClean,
    date: input.date,
    accountId: input.account.source === "plaid" ? input.account.id : null,
    manualAccountId: input.account.source === "manual" ? input.account.id : null,
    category: input.category || null,
    goalId: input.goal_id || null,
    notes: input.notes?.trim() || null,
  };
}
