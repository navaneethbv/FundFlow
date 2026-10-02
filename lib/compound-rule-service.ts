import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  simulateRulesBatch,
  type SmartRule,
  type RuleTransactionCandidate,
} from "@/lib/rules-engine";
import { validateConditions, type RuleCondition } from "@/lib/rule-conditions";
import {
  storedRuleActions,
  validateRuleActions,
  type RuleActions,
} from "@/lib/rule-actions";
import { TRANSFER_GROUPS } from "@/lib/finance-domain";
export interface StoredCompoundRule {
  id: string;
  match_type: SmartRule["matchType"] | "compound";
  pattern: string;
  display_name: string | null;
  category: string | null;
  tags: string[];
  conditions: RuleCondition | null;
  actions: RuleActions | null;
  amount_condition: SmartRule["amountCondition"];
  enabled: boolean;
}
export interface RuleCandidate extends RuleTransactionCandidate {
  version: string;
  annotationVersion: string | null;
  previousActions?: RuleActions;
}
export async function loadRules(
  reader: SupabaseClient,
  userId: string,
): Promise<StoredCompoundRule[]> {
  const { data, error } = await reader
    .from("merchant_rules")
    .select(
      "id,match_type,pattern,display_name,category,tags,conditions,actions,amount_condition,enabled",
    )
    .eq("user_id", userId)
    .order("created_at")
    .order("id")
    .limit(101);
  if (error) throw error;
  if ((data?.length ?? 0) > 100)
    throw new Error("At most 100 rules may be evaluated at once");
  return (data ?? []) as StoredCompoundRule[];
}
export async function loadRuleCandidates(
  reader: SupabaseClient,
  userId: string,
  window: { start: string; end: string },
  ids?: string[],
): Promise<RuleCandidate[]> {
  if (ids && !ids.length) return [];
  let query = reader
    .from("transactions")
    .select(
      "id,merchant_name,name,original_description,account_id,manual_account_id,amount,pfc_primary,updated_at",
    )
    .eq("user_id", userId)
    .eq("pending", false)
    .gte("date", window.start)
    .lte("date", window.end)
    .order("id")
    .limit(501);
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw error;
  if ((data?.length ?? 0) > 500)
    throw new Error("More than 500 transactions; choose a shorter date range");
  if (!data?.length) return [];
  const [annotations, accounts] = await Promise.all([
    reader
      .from("transaction_annotations")
      .select(
        "transaction_id,note,tags,display_category,rule_actions,updated_at",
      )
      .eq("user_id", userId)
      .in(
        "transaction_id",
        data.map((row) => row.id),
      ),
    reader.from("accounts").select("id,name").eq("user_id", userId).limit(1000),
  ]);
  if (annotations.error) throw annotations.error;
  if (accounts.error) throw accounts.error;
  const byId = new Map(
    (annotations.data ?? []).map((row) => [row.transaction_id, row]),
  );
  const accountNames = new Map(
    (accounts.data ?? []).map((row) => [row.id, row.name]),
  );
  return data.map((row) => {
    const annotation = byId.get(row.id);
    const amount = Number(row.amount);
    return {
      id: row.id,
      merchant: row.merchant_name,
      name: row.name,
      descriptor: row.original_description,
      accountId: row.account_id ?? row.manual_account_id,
      accountName: accountNames.get(row.account_id) ?? "",
      amount,
      category: annotation?.display_category ?? row.pfc_primary,
      notes: annotation?.note,
      tags: annotation?.tags ?? [],
      type: TRANSFER_GROUPS.has(row.pfc_primary)
        ? "transfer"
        : amount < 0
          ? "income"
          : "expense",
      version: row.updated_at,
      annotationVersion: annotation?.updated_at ?? null,
      previousActions: annotation ? storedRuleActions(annotation) : undefined,
    };
  });
}
export function simulateCompoundRules(
  rules: StoredCompoundRule[],
  candidates: RuleCandidate[],
) {
  for (const rule of rules) {
    if (
      rule.conditions &&
      (!validateConditions(rule.conditions) ||
        !validateRuleActions(rule.actions))
    )
      throw new Error("Stored rule is invalid; edit it before applying");
  }
  return simulateRulesBatch(
    rules.map((rule) => ({
      id: rule.id,
      matchType: rule.match_type as SmartRule["matchType"],
      pattern: rule.pattern,
      conditions: rule.conditions,
      amountCondition: rule.amount_condition,
      enabled: rule.enabled,
      displayName: rule.actions?.displayName ?? rule.display_name,
      category: rule.actions?.category ?? rule.category,
      tags: rule.actions?.tags ?? rule.tags,
    })),
    candidates,
  );
}
function ruleActions(rule: StoredCompoundRule): RuleActions {
  if (rule.conditions) return rule.actions!;
  return {
    ...(rule.display_name ? { displayName: rule.display_name } : {}),
    ...(rule.category ? { category: rule.category } : {}),
    ...(rule.tags?.length ? { tags: rule.tags } : {}),
  };
}
export async function applyCompoundRules(
  writer: SupabaseClient,
  userId: string,
  trigger: "manual" | "sync" | "import",
  rules: StoredCompoundRule[],
  candidates: RuleCandidate[],
  onlyRuleId?: string,
): Promise<number> {
  if (!isFeatureEnabled("compoundRules")) return 0;
  const simulation = simulateCompoundRules(rules, candidates);
  const matches = new Map<string, RuleCandidate[]>();
  const byId = new Map(candidates.map((row) => [row.id, row]));
  for (const result of simulation.results) {
    if (!result.matchedRuleId) continue;
    const rows = matches.get(result.matchedRuleId) ?? [];
    rows.push(byId.get(result.transactionId)!);
    matches.set(result.matchedRuleId, rows);
  }
  let changed = 0;
  // Each independent rule run is atomic; failures retain earlier completed run evidence.
  for (const rule of rules) {
    if (onlyRuleId && rule.id !== onlyRuleId) continue;
    const rows = matches.get(rule.id) ?? [];
    // Legacy rules remain projection-only during ingestion, preserving prior semantics.
    if (!rule.conditions && trigger !== "manual") continue;
    changed += await applyOneRun(writer, userId, trigger, rule, rows);
  }
  return changed;
}
async function applyOneRun(
  writer: SupabaseClient,
  userId: string,
  trigger: "manual" | "sync" | "import",
  rule: StoredCompoundRule,
  rows: RuleCandidate[],
): Promise<number> {
  let runId: string | null = null;
  if (isFeatureEnabled("ruleRunHistory")) {
    const { data, error } = await writer
      .from("rule_runs")
      .insert({
        user_id: userId,
        rule_id: rule.id,
        trigger,
        matched: rows.length,
      })
      .select("id")
      .single();
    if (error) throw error;
    runId = data.id;
  }
  try {
    const actions = ruleActions(rule);
    const { data, error } = await writer.rpc("apply_compound_rule_run", {
      p_user_id: userId,
      p_run_id: runId,
      p_rows: rows.map((row) => ({
        id: row.id,
        version: row.version,
        annotationVersion: row.annotationVersion,
        actions,
        ruleId: rule.id,
      })),
    });
    if (error) throw error;
    return Number(data);
  } catch (error) {
    if (runId) {
      const failure = await writer
        .from("rule_runs")
        .update({
          status: "failed",
          error: "No changes in this run. Refresh the preview and retry.",
          completed_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", runId);
      if (failure.error)
        throw new AggregateError(
          [error, failure.error],
          "Rule run and failure journal could not complete",
        );
    }
    throw error;
  }
}

/** Ingestion only evaluates the committed ids; it never scans another owner's rows. */
export async function processRuleAutomation(
  reader: SupabaseClient,
  writer: SupabaseClient,
  userId: string,
  trigger: "sync" | "import",
  providerIds: string[],
): Promise<void> {
  if (!isFeatureEnabled("compoundRules") || !providerIds.length) return;
  const rules = await loadRules(reader, userId);
  if (!rules.some((rule) => rule.enabled && rule.conditions)) return;
  let offset = 0;
  while (offset < providerIds.length) {
    const ids = providerIds.slice(offset, offset + 200);
    const { data, error } = await reader
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .in("plaid_transaction_id", ids)
      .limit(201);
    if (error) throw error;
    const candidates = await loadRuleCandidates(
      reader,
      userId,
      { start: "0001-01-01", end: "9999-12-31" },
      (data ?? []).map((row) => row.id),
    );
    await applyCompoundRules(writer, userId, trigger, rules, candidates);
    offset += ids.length;
  }
}
