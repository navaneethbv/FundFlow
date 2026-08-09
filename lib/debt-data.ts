import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPayoffPlan, type PayoffPlan } from "@/lib/debt";
import {
  scopeQueryUserId,
  type FinancialScope,
} from "@/lib/financial-scope";

export type DebtStrategy = "avalanche" | "snowball";

export interface DebtPlannerAccountInput {
  id: string;
  name: string;
  balance: number;
  apr: number | null;
}

export interface DebtPlannerAccount {
  id: string;
  name: string;
  balance: number;
  apr: number;
  aprAssumed: boolean;
  minimumPayment: number;
}

export interface DebtPlannerData {
  debts: DebtPlannerAccount[];
  totalBalance: number;
  totalMonthlyBudget: number;
  avalanche: PayoffPlan | null;
  snowball: PayoffPlan | null;
}

const ASSUMED_APR = 22;
const LIABILITY_TYPES = new Set(["credit", "loan", "liability", "debt"]);

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseDebtStrategy(
  value: string | readonly string[] | undefined,
): DebtStrategy {
  return first(value) === "snowball" ? "snowball" : "avalanche";
}

export function parseExtraMonthly(
  value: string | readonly string[] | undefined,
): number {
  const raw = first(value);
  if (!raw || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? round2(parsed) : 0;
}

export function buildDebtPlannerData(
  accounts: DebtPlannerAccountInput[],
  extraMonthly: number,
): DebtPlannerData {
  const debts = accounts
    .map((account) => {
      const balance = round2(Math.abs(account.balance));
      const aprAssumed = account.apr === null;
      const apr = account.apr ?? ASSUMED_APR;
      return {
        id: account.id,
        name: account.name,
        balance,
        apr,
        aprAssumed,
        minimumPayment: round2(Math.max(25, balance * 0.02)),
      };
    })
    .filter((account) => account.balance > 0);

  if (debts.length === 0) {
    return {
      debts: [],
      totalBalance: 0,
      totalMonthlyBudget: 0,
      avalanche: null,
      snowball: null,
    };
  }

  const normalizedExtra = Math.max(0, round2(extraMonthly));
  const planDebts = debts.map((debt) => ({
    name: debt.name,
    balance: debt.balance,
    apr: debt.apr,
    minPayment: debt.minimumPayment,
  }));

  return {
    debts,
    totalBalance: round2(debts.reduce((sum, debt) => sum + debt.balance, 0)),
    totalMonthlyBudget: round2(
      debts.reduce((sum, debt) => sum + debt.minimumPayment, 0)
        + normalizedExtra,
    ),
    avalanche: buildPayoffPlan({
      debts: planDebts,
      extraMonthly: normalizedExtra,
      strategy: "avalanche",
    }),
    snowball: buildPayoffPlan({
      debts: planDebts,
      extraMonthly: normalizedExtra,
      strategy: "snowball",
    }),
  };
}

export async function loadDebtPlannerData(
  supabase: SupabaseClient,
  options: { scope: FinancialScope; extraMonthly: number },
): Promise<DebtPlannerData> {
  const userId = scopeQueryUserId(options.scope);
  let query = supabase
    .from("accounts")
    .select("id,user_id,name,type,subtype,current_balance,apr")
    .order("name")
    .limit(5000);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) {
    const suffix = error.code ? `:${error.code}` : "";
    throw new Error(`debt_accounts_query_failed${suffix}`);
  }

  const accounts = (data ?? [])
    .filter((row) => LIABILITY_TYPES.has(String(row.type ?? "").toLowerCase()))
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? "Debt"),
      balance: Number(row.current_balance ?? 0),
      apr: row.apr === null ? null : Number(row.apr),
    }));

  return buildDebtPlannerData(accounts, options.extraMonthly);
}
