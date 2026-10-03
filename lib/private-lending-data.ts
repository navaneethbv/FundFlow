import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPrivateLoanBalance,
  type PrivateLoan,
  type PrivateLoanView,
  summarizePrivateLending,
} from "@/lib/private-lending";

export interface PrivateLendingData {
  loans: PrivateLoanView[];
  summary: ReturnType<typeof summarizePrivateLending>;
}

export async function loadPrivateLendingData(
  supabase: SupabaseClient,
  userId: string,
  asOf: string,
): Promise<PrivateLendingData> {
  const { data: loanRows, error: loanError } = await supabase
    .from("private_loans")
    .select("id,direction,counterparty,principal,annual_interest_rate,start_date,due_date,notes,status")
    .eq("user_id", userId)
    .order("start_date", { ascending: false })
    .limit(200);
  if (loanError) throw loanError;
  const ids = (loanRows ?? []).map((row) => row.id as string);
  const { data: paymentRows, error: paymentError } = ids.length === 0
    ? { data: [], error: null }
    : await supabase
      .from("private_loan_payments")
      .select("id,loan_id,payment_date,amount,note")
      .eq("user_id", userId)
      .in("loan_id", ids)
      .order("payment_date")
      .limit(5000);
  if (paymentError) throw paymentError;
  const paymentsByLoan = new Map<string, PrivateLoan["payments"]>();
  for (const row of paymentRows ?? []) {
    const loanId = row.loan_id as string;
    const payments = paymentsByLoan.get(loanId) ?? [];
    payments.push({
      id: row.id as string,
      paymentDate: row.payment_date as string,
      amount: Number(row.amount),
      note: row.note as string | null,
    });
    paymentsByLoan.set(loanId, payments);
  }
  const loans = (loanRows ?? []).map((row): PrivateLoanView => {
    const loan: PrivateLoan = {
      id: row.id as string,
      direction: row.direction as PrivateLoan["direction"],
      counterparty: row.counterparty as string,
      principal: Number(row.principal),
      annualInterestRate: Number(row.annual_interest_rate ?? 0),
      startDate: row.start_date as string,
      dueDate: row.due_date as string | null,
      notes: row.notes as string | null,
      status: row.status as PrivateLoan["status"],
      payments: paymentsByLoan.get(row.id as string) ?? [],
    };
    return { ...loan, balance: buildPrivateLoanBalance(loan, asOf) };
  });
  return { loans, summary: summarizePrivateLending(loans) };
}
