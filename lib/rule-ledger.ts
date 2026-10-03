import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { storedRuleActions, type RuleActions } from "@/lib/rule-actions";
export async function attachLedgerRuleActions<T extends { id: string }>(
  reader: SupabaseClient,
  userId: string,
  rows: T[],
): Promise<
  (T & { ruleActions?: RuleActions; manualCategory?: string | null })[]
> {
  if (!isFeatureEnabled("compoundRules") || !rows.length) return rows;
  const actions = new Map<
    string,
    { ruleActions?: RuleActions; manualCategory: string | null }
  >();
  const chunks = Array.from({ length: Math.ceil(rows.length / 200) }, (_, index) =>
    rows.slice(index * 200, index * 200 + 200).map((row) => row.id),
  );
  const results = await Promise.all(
    chunks.map((ids) =>
      reader
        .from("transaction_annotations")
        .select("transaction_id,display_category,rule_actions")
        .eq("user_id", userId)
        .in("transaction_id", ids),
    ),
  );
  for (const result of results) {
    if (result.error) throw result.error;
    for (const row of result.data ?? [])
      actions.set(row.transaction_id, {
        ruleActions: storedRuleActions(row),
        manualCategory: row.display_category,
      });
  }
  return rows.map((row) => ({ ...row, ...actions.get(row.id) }));
}
