import type { createClient } from "@/lib/supabase/server";

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
}

/** Percentage of a goal's target that has been saved, clamped to 0-100. */
export function goalProgressPct(saved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((saved / target) * 100)));
}

/** Owner-scoped goals for the signed-in user (RLS-bound), oldest first. */
export async function getGoals(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Goal[]> {
  const { data } = await supabase
    .from("goals")
    .select("id, name, target_amount, saved_amount, target_date")
    .order("created_at");
  return (data ?? []) as Goal[];
}
