import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { BatchSimulationResult, SmartRule } from "@/lib/rules-engine";
export async function beginLegacyRuleRuns(
  writer: SupabaseClient,
  userId: string,
  rules: SmartRule[],
  simulation: BatchSimulationResult,
): Promise<{ id: string; rule_id: string }[]> {
  if (!isFeatureEnabled("ruleRunHistory")) return [];
  const rows = rules.map((rule) => ({
    user_id: userId,
    rule_id: rule.id,
    trigger: "manual",
    matched: simulation.results.filter(
      (result) => result.matchedRuleId === rule.id,
    ).length,
  }));
  if (!rows.length) return [];
  const { data, error } = await writer
    .from("rule_runs")
    .insert(rows)
    .select("id,rule_id");
  if (error) throw error;
  return data ?? [];
}
export async function finishLegacyRuleRuns(
  writer: SupabaseClient,
  userId: string,
  runs: { id: string; rule_id: string }[],
  simulation: BatchSimulationResult,
  status: "success" | "failed",
): Promise<void> {
  await Promise.all(runs.map(async (run) => {
    const modified = simulation.results.filter(
      (result) => result.modified && result.matchedRuleId === run.rule_id,
    );
    if (status === "success" && modified.length) {
      const { error } = await writer
        .from("rule_changes")
        .insert(
          modified.map((row) => ({
            user_id: userId,
            run_id: run.id,
            transaction_id: row.transactionId,
          })),
        );
      if (error) throw error;
    }
    const { error } = await writer
      .from("rule_runs")
      .update({
        status,
        changed: status === "success" ? modified.length : null,
        error:
          status === "failed"
            ? "Application may be partial. Inspect transactions before retrying."
            : null,
        completed_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("id", run.id)
      .eq("status", "running");
    if (error) throw error;
  }));
}
