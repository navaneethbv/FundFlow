import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupKeyFor } from "@/lib/accounts-page";
import type { AdviceContext, AdviceProfileAnswers } from "@/lib/advice";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { ESSENTIAL_PFC_PRIMARY, computeRunwayMonths } from "@/lib/insights";

function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function monthsBack(today: string, count: number): string {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 - (count - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export interface AdvicePageData {
  ctx: AdviceContext;
  progress: { advice_id: string; task_id: string }[];
  priorities: string[] | null;
  profile: AdviceProfileAnswers | null;
}

export async function loadAdvicePageData(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<AdvicePageData> {
  const [accountsResult, manualResult, budgetsResult, goalsResult, profileResult, progressResult, projection] =
    await Promise.all([
      supabase.from("accounts").select("type, subtype, current_balance").eq("user_id", userId),
      supabase.from("manual_accounts").select("account_type").eq("user_id", userId),
      supabase.from("budgets").select("id").eq("user_id", userId).limit(1),
      supabase.from("goals").select("id").eq("user_id", userId).limit(1),
      supabase.from("profiles").select("advice_priorities, advice_profile").eq("id", userId).maybeSingle(),
      supabase.from("advice_progress").select("advice_id, task_id").eq("user_id", userId),
      loadCanonicalProjection(supabase, {
        scope: { kind: "mine", ownerUserId: userId },
        window: { start: monthsBack(today, 3), endExclusive: dayAfter(today) },
      }),
    ]);
  if (accountsResult.error) throw accountsResult.error;
  if (manualResult.error) throw manualResult.error;
  if (budgetsResult.error) throw budgetsResult.error;
  if (goalsResult.error) throw goalsResult.error;
  if (profileResult.error) throw profileResult.error;
  if (progressResult.error) throw progressResult.error;

  const accounts = accountsResult.data ?? [];
  const cash = accounts
    .filter((a) => groupKeyFor(a.type as string | null, a.subtype as string | null) === "cash")
    .reduce((sum, a) => sum + Number(a.current_balance ?? 0), 0);
  const creditCardCarry = accounts.some(
    (a) =>
      groupKeyFor(a.type as string | null, a.subtype as string | null) === "credit" &&
      Number(a.current_balance ?? 0) > 0,
  );
  const hasInvestments =
    accounts.some((a) => groupKeyFor(a.type as string | null, a.subtype as string | null) === "investment") ||
    (manualResult.data ?? []).some((m) => m.account_type === "investment");

  const monthlyEssentials = new Map<string, number>();
  for (const t of projection.transactions) {
    if (t.flow !== "expense" || !ESSENTIAL_PFC_PRIMARY.has(t.groupKey)) continue;
    const month = t.date.slice(0, 7);
    monthlyEssentials.set(month, (monthlyEssentials.get(month) ?? 0) + t.signedAmount);
  }
  // The current calendar month is partial and would drag the estimate down.
  const currentMonth = today.slice(0, 7);
  const essentials = [...monthlyEssentials.entries()]
    .filter(([month]) => month !== currentMonth)
    .map(([, amount]) => amount);

  const ctx: AdviceContext = {
    runwayMonths: computeRunwayMonths({ liquidBalance: cash, monthlyEssentials: essentials }),
    hasBudget: (budgetsResult.data ?? []).length > 0,
    hasGoals: (goalsResult.data ?? []).length > 0,
    creditCardCarry,
    hasInvestments,
  };

  const priorities = Array.isArray(profileResult.data?.advice_priorities)
    ? (profileResult.data!.advice_priorities as string[])
    : null;
  const profile = (profileResult.data?.advice_profile as AdviceProfileAnswers | null) ?? null;

  return {
    ctx,
    progress: (progressResult.data ?? []) as { advice_id: string; task_id: string }[],
    priorities,
    profile,
  };
}
