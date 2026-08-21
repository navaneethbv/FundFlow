import type { SupabaseClient } from "@supabase/supabase-js";
import {
  goalContributionsForMonth,
  type GoalV2Row,
} from "@/lib/goals-v2";
import {
  budgetWindow,
  buildBudgetView,
  proposeBudgetFromHistory,
  type BudgetHorizon,
  type BudgetPeriodRecord,
  type BudgetRecord,
  type BudgetSeedProposal,
  type BudgetViewData,
} from "@/lib/budget-page";
import { partitionCashFlowByCurrency } from "@/lib/cash-flow";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  parseFinancialScope,
  scopeQueryUserId,
  type FinancialScope,
} from "@/lib/financial-scope";
import {
  FINANCE_MAX_ROWS,
  loadCanonicalProjection,
} from "@/lib/finance-query";
import {
  computeSinkingFunds,
  type SinkingFundInput,
} from "@/lib/insights";
import { firstSearchParam } from "@/lib/search-params";

const DEPENDENCY_LIMIT = 5_000;
const MONTH_REGEX = /^(\d{4})-(0[1-9]|1[0-2])$/;

interface BudgetRow {
  id: string;
  category: string;
  monthly_limit: number | string;
  group_name: string | null;
  rollover_enabled: boolean | null;
  sort_order: number | null;
}

interface BudgetPeriodRow {
  budget_id: string;
  month: string;
  planned: number | string;
}

interface SinkingFundRow {
  name: string;
  target_amount: number | string;
  due_date: string;
  cadence: SinkingFundInput["cadence"];
  custom_interval_months: number | null;
  cycle_anchor_date: string;
}

interface RecurringRow {
  category: string | null;
}

interface SyncRow {
  updated_at: string;
}

type GoalContributionSource = Pick<
  GoalV2Row,
  "id" | "name" | "monthly_contribution"
>;

interface GoalEventRow {
  goal_id: string;
  event_date: string;
  amount: number | string;
}

/** First day of the month after `month`, for an exclusive date bound. */
function getMonthEndExclusive(month: string): string {
  const match = MONTH_REGEX.exec(month);
  // c8 ignore next -- callers validate against MONTH_REGEX before calling
  if (!match) throw new Error("invalid_budget_month");
  const total = Number(match[1]) * 12 + Number(match[2]);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export interface BudgetLoadResult {
  view: BudgetViewData;
  scope: FinancialScope;
  visibleHouseholdIds: string[];
  currencies: string[];
  selectedCurrency: string | null;
  proposals: BudgetSeedProposal[];
  truncated: boolean;
  stale: boolean;
}

function shiftMonth(month: string, delta: number): string {
  const match = MONTH_REGEX.exec(month);
  // c8 ignore next -- callers validate against MONTH_REGEX before calling
  if (!match) throw new Error("invalid_budget_month");
  const total = Number(match[1]) * 12 + Number(match[2]) - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function assertBudgetQuery(
  table: string,
  result: { error: { code?: string } | null },
): void {
  if (!result.error) return;
  const code = result.error.code ? `:${result.error.code}` : "";
  throw new Error(`budget_query_failed:${table}${code}`);
}

function isStale(lastSuccessfulSyncAt: string | null, now: Date): boolean {
  if (!lastSuccessfulSyncAt) return true;
  const parsed = Date.parse(lastSuccessfulSyncAt);
  return (
    !Number.isFinite(parsed) ||
    now.getTime() - parsed > 48 * 60 * 60 * 1000
  );
}

export async function loadBudgetData(
  supabase: SupabaseClient,
  input: {
    userId: string;
    anchorMonth: string;
    horizon: BudgetHorizon;
    rawScope?: string | string[];
    requestedCurrency?: string | string[];
    now?: Date;
  },
): Promise<BudgetLoadResult> {
  if (!MONTH_REGEX.test(input.anchorMonth)) {
    throw new Error("invalid_budget_month");
  }

  const householdResult = await supabase
    .from("households")
    .select("id")
    .limit(DEPENDENCY_LIMIT);
  assertBudgetQuery("households", householdResult);
  const visibleHouseholdIds = (householdResult.data ?? []).map(
    (row) => row.id as string,
  );
  const scope = parseFinancialScope({
    raw: input.rawScope,
    ownerUserId: input.userId,
    visibleHouseholdIds,
  });
  const userId = scopeQueryUserId(scope);
  const viewWindow = budgetWindow(input.anchorMonth, input.horizon);
  const previousViewMonth = shiftMonth(
    viewWindow.start.slice(0, 7),
    -1,
  );
  const trailingStart = shiftMonth(input.anchorMonth, -3);
  const projectionStart =
    previousViewMonth < trailingStart ? previousViewMonth : trailingStart;

  let budgetsQuery = supabase
    .from("budgets")
    .select(
      "id,category,monthly_limit,group_name,rollover_enabled,sort_order",
    )
    .order("sort_order")
    .order("category")
    .limit(DEPENDENCY_LIMIT);
  let periodsQuery = supabase
    .from("budget_periods")
    .select("budget_id,month,planned")
    .gte("month", `${projectionStart}-01`)
    .lt("month", viewWindow.endExclusive)
    .order("month")
    .limit(DEPENDENCY_LIMIT);
  let sinkingFundsQuery = supabase
    .from("sinking_funds")
    .select(
      "name,target_amount,due_date,cadence,custom_interval_months,cycle_anchor_date",
    )
    .order("due_date")
    .limit(DEPENDENCY_LIMIT);
  let recurringQuery = supabase
    .from("recurring_streams")
    .select("category")
    .eq("is_active", true)
    .limit(DEPENDENCY_LIMIT);
  let syncQuery = supabase
    .from("sync_jobs")
    .select("updated_at")
    .eq("status", "done")
    .eq("job_type", "transactions")
    .order("updated_at", { ascending: false })
    .limit(1);
  // Phase 7 contributions: planned comes from the goal, actual from the event
  // ledger for this month only. Balance movement is deliberately not read here
  // (see goalContributionsForMonth).
  //
  // Gated: `goal_progress_events` only exists once 20260730200000_goals_v2.sql
  // is applied, and /budget is already released. With the flag off the page
  // behaves exactly as it did before Phase 7 instead of erroring.
  const goalsV2Enabled = isFeatureEnabled("goalsV2");
  let goalsQuery = supabase
    .from("goals")
    .select("id,name,monthly_contribution")
    .order("name")
    .limit(DEPENDENCY_LIMIT);
  let goalEventsQuery = supabase
    .from("goal_progress_events")
    .select("goal_id,event_date,amount")
    .gte("event_date", `${input.anchorMonth}-01`)
    .lt("event_date", getMonthEndExclusive(input.anchorMonth))
    .limit(DEPENDENCY_LIMIT);

  if (userId) {
    budgetsQuery = budgetsQuery.eq("user_id", userId);
    periodsQuery = periodsQuery.eq("user_id", userId);
    sinkingFundsQuery = sinkingFundsQuery.eq("user_id", userId);
    recurringQuery = recurringQuery.eq("user_id", userId);
    syncQuery = syncQuery.eq("user_id", userId);
    goalsQuery = goalsQuery.eq("user_id", userId);
    goalEventsQuery = goalEventsQuery.eq("user_id", userId);
  }

  const [
    budgetsResult,
    periodsResult,
    sinkingFundsResult,
    recurringResult,
    syncResult,
    projection,
    goalsResult,
    goalEventsResult,
  ] = await Promise.all([
    budgetsQuery,
    periodsQuery,
    sinkingFundsQuery,
    recurringQuery,
    syncQuery.maybeSingle(),
    loadCanonicalProjection(supabase, {
      scope,
      window: {
        start: `${projectionStart}-01`,
        endExclusive: viewWindow.endExclusive,
      },
      maxRows: FINANCE_MAX_ROWS,
    }),
    goalsV2Enabled ? goalsQuery : Promise.resolve({ data: [], error: null }),
    goalsV2Enabled
      ? goalEventsQuery
      : Promise.resolve({ data: [], error: null }),
  ]);

  assertBudgetQuery("budgets", budgetsResult);
  assertBudgetQuery("budget_periods", periodsResult);
  assertBudgetQuery("sinking_funds", sinkingFundsResult);
  assertBudgetQuery("recurring_streams", recurringResult);
  assertBudgetQuery("sync_jobs", syncResult);
  assertBudgetQuery("goals", goalsResult);
  assertBudgetQuery("goal_progress_events", goalEventsResult);

  const budgets: BudgetRecord[] = (
    (budgetsResult.data ?? []) as BudgetRow[]
  ).map((row) => ({
    id: row.id,
    category: row.category,
    monthly_limit: Number(row.monthly_limit),
    group_name: row.group_name ?? "flexible",
    rollover_enabled: Boolean(row.rollover_enabled),
    sort_order: Number(row.sort_order ?? 0),
  }));
  const periods: BudgetPeriodRecord[] = (
    (periodsResult.data ?? []) as BudgetPeriodRow[]
  ).map((row) => ({
    budget_id: row.budget_id,
    month: row.month,
    planned: Number(row.planned),
  }));
  const sinkingFundInputs: SinkingFundInput[] = (
    (sinkingFundsResult.data ?? []) as SinkingFundRow[]
  ).map((row) => ({
    name: row.name,
    targetAmount: Number(row.target_amount),
    dueDate: row.due_date,
    cadence: row.cadence,
    customIntervalMonths: row.custom_interval_months,
    cycleAnchorDate: row.cycle_anchor_date,
  }));
  const sinkingFunds = computeSinkingFunds({
    funds: sinkingFundInputs,
    asOf: `${input.anchorMonth}-01`,
  }).items;
  const byCurrency = partitionCashFlowByCurrency(
    projection.transactions,
    projection.currencyByAccountId,
  );
  const currencies = [...byCurrency.keys()];
  const requestedCurrency = firstSearchParam(input.requestedCurrency)
    ?.trim()
    .toUpperCase();
  const selectedCurrency =
    requestedCurrency && byCurrency.has(requestedCurrency)
      ? requestedCurrency
      : currencies[0] ?? null;
  const selectedTransactions = selectedCurrency
    ? byCurrency.get(selectedCurrency) ?? []
    : [];
  const trailingCompleteTransactions = selectedTransactions.filter(
    (transaction) =>
      transaction.date >= `${trailingStart}-01` &&
      transaction.date < `${input.anchorMonth}-01`,
  );
  const recurringCategories = new Set(
    ((recurringResult.data ?? []) as RecurringRow[])
      .map((row) => row.category?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  const recurringSourceIds = new Set(
    trailingCompleteTransactions
      .filter(
        (transaction) =>
          recurringCategories.has(transaction.groupKey.toLowerCase()) ||
          recurringCategories.has(transaction.categoryKey.toLowerCase()),
      )
      .map((transaction) => transaction.sourceTransactionId),
  );
  const lastSuccessfulSyncAt =
    ((syncResult.data as SyncRow | null)?.updated_at as
      | string
      | undefined) ?? null;

  return {
    view: buildBudgetView({
      month: input.anchorMonth,
      horizon: input.horizon,
      budgets,
      periods,
      txns: selectedTransactions,
      sinkingFunds,
      goalContributions: goalContributionsForMonth(
        (goalsResult.data ?? []) as GoalContributionSource[],
        ((goalEventsResult.data ?? []) as GoalEventRow[]).map((row) => ({
          goal_id: row.goal_id,
          event_date: row.event_date,
          amount: Number(row.amount),
        })),
        input.anchorMonth,
      ).map((line) => ({
        name: line.name,
        planned: line.planned,
        actual: line.actual,
      })),
    }),
    scope,
    visibleHouseholdIds,
    currencies,
    selectedCurrency,
    proposals: proposeBudgetFromHistory({
      txnsLast3Months: trailingCompleteTransactions,
      recurringTransactionIds: recurringSourceIds,
      sinkingFunds,
      existingCategories: new Set(
        budgets.map((budget) => budget.category),
      ),
    }),
    truncated: projection.truncated,
    stale: isStale(lastSuccessfulSyncAt, input.now ?? new Date()),
  };
}
