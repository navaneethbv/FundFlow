import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  simulateRulesBatch,
  type SmartRule,
  type RuleTransactionCandidate,
} from "@/lib/rules-engine";

type SimulationItem = ReturnType<typeof simulateRulesBatch>["results"][number];

interface BatchRulesRequest {
  dryRun?: boolean;
}

interface DbMerchantRule {
  id: string;
  match_type: "merchant" | "keyword" | "account" | "regex";
  pattern: string;
  display_name: string | null;
  category: string | null;
  enabled: boolean;
}

interface DbTransaction {
  id: string;
  merchant_name: string | null;
  name: string | null;
  amount: number | string;
  pfc_primary: string | null;
}

interface DbAnnotation {
  transaction_id: string;
  tags: string[] | null;
}

async function loadUserRules(
  supabase: SupabaseClient,
  userId: string,
): Promise<SmartRule[] | Response> {
  const { data: dbRules, error: rulesError } = await supabase
    .from("merchant_rules")
    .select("id, match_type, pattern, display_name, category, enabled")
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (rulesError) {
    return errorResponse("Failed to load rules: " + rulesError.message, 500);
  }

  const typedDbRules = (dbRules || []) as unknown as DbMerchantRule[];
  return typedDbRules.map((r) => ({
    id: r.id,
    matchType: r.match_type,
    pattern: r.pattern,
    displayName: r.display_name,
    category: r.category,
    enabled: r.enabled,
  }));
}

async function fetchCandidateTransactions(
  supabase: SupabaseClient,
  userId: string,
): Promise<RuleTransactionCandidate[] | Response> {
  const { data: txns, error: txError } = await supabase
    .from("transactions")
    .select("id, merchant_name, name, amount, pfc_primary")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    // Rules run retroactively on history, so cover a large window; pagination
    // is avoided to keep the batch evaluation a single atomic simulation.
    .limit(5000);

  if (txError) {
    return errorResponse("Failed to load transactions: " + txError.message, 500);
  }

  const typedTxns = (txns || []) as unknown as DbTransaction[];
  const txnIds = typedTxns.map((t) => t.id);
  const annotationsMap = new Map<string, string[]>();

  if (txnIds.length > 0) {
    const { data: annotations } = await supabase
      .from("transaction_annotations")
      .select("transaction_id, tags")
      .in("transaction_id", txnIds);

    const typedAnnotations = (annotations || []) as unknown as DbAnnotation[];
    for (const a of typedAnnotations) {
      if (Array.isArray(a.tags)) {
        annotationsMap.set(a.transaction_id, a.tags);
      }
    }
  }

  return typedTxns.map((t) => ({
    id: t.id,
    merchant: t.merchant_name,
    name: t.name,
    amount: Number(t.amount) || 0,
    category: t.pfc_primary,
    tags: annotationsMap.get(t.id) || [],
  }));
}

async function applyBatchLivePersistence(
  modifiedItems: SimulationItem[],
  supabase: SupabaseClient,
  userId: string,
  auditContext: {
    ip: string | null;
    totalEvaluated: number;
    matchedCount: number;
  },
): Promise<number> {
  let appliedCount = 0;

  // A. Bulk upsert annotations (tags and display_category)
  const annotationRows = modifiedItems
    .filter(
      (r) =>
        (r.updated.category && r.updated.category !== r.original.category) ||
        r.updated.tags.length !== r.original.tags.length ||
        r.updated.tags.some((t, i) => t !== r.original.tags[i]),
    )
    .map((r) => ({
      user_id: userId,
      transaction_id: r.transactionId,
      tags: r.updated.tags,
      ...(r.updated.category && r.updated.category !== r.original.category
        ? { display_category: r.updated.category }
        : {}),
      updated_at: new Date().toISOString(),
    }));

  if (annotationRows.length > 0) {
    const { error: upsertError } = await supabase
      .from("transaction_annotations")
      .upsert(annotationRows, { onConflict: "user_id,transaction_id" });

    if (upsertError) {
      await writeAudit({
        userId,
        action: "rules_batch_applied",
        ip: auditContext.ip,
        metadata: {
          phase: "result",
          totalEvaluated: auditContext.totalEvaluated,
          matchedCount: auditContext.matchedCount,
          appliedCount,
          failed_table: "transaction_annotations",
        },
      });
      throw upsertError;
    }
    appliedCount += annotationRows.length;
  }

  // B. Persist merchant renaming to transactions table (grouped by target merchant name)
  const merchantUpdates = modifiedItems.filter(
    (r) => r.updated.merchant && r.updated.merchant !== r.original.merchant,
  );
  if (merchantUpdates.length > 0) {
    const service = createServiceClient();
    const byMerchant = new Map<string, string[]>();
    for (const item of merchantUpdates) {
      const targetName = item.updated.merchant;
      if (!targetName) {
        continue;
      }
      const list = byMerchant.get(targetName) ?? [];
      list.push(item.transactionId);
      byMerchant.set(targetName, list);
    }

    for (const [newMerchant, ids] of byMerchant.entries()) {
      const { error: merchantError } = await service
        .from("transactions")
        .update({ merchant_name: newMerchant, updated_at: new Date().toISOString() })
        .in("id", ids)
        .eq("user_id", userId);

      if (merchantError) {
        await writeAudit({
          userId,
          action: "rules_batch_applied",
          ip: auditContext.ip,
          metadata: {
            phase: "result",
            totalEvaluated: auditContext.totalEvaluated,
            matchedCount: auditContext.matchedCount,
            appliedCount,
            failed_table: "transactions",
          },
        });
        throw merchantError;
      }

      const notInAnnotations = ids.filter(
        (id) => !annotationRows.some((a) => a.transaction_id === id),
      );
      appliedCount += notInAnnotations.length;
    }
  }

  return appliedCount;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user, supabase } = auth;

  if (!(await checkRateLimit(`rules:batch:${user.id}`, 30, 3600))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: BatchRulesRequest;
  try {
    body = (await req.json()) as BatchRulesRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const dryRun = body.dryRun !== false;

  const rulesResult = await loadUserRules(supabase, user.id);
  if (rulesResult instanceof Response) return rulesResult;
  const rulesToRun = rulesResult;

  if (rulesToRun.length === 0) {
    return NextResponse.json({
      success: true,
      dryRun,
      totalEvaluated: 0,
      matchedCount: 0,
      modifiedCount: 0,
      appliedCount: 0,
      preview: [],
      message: "No active rules to apply.",
    });
  }

  const candidatesResult = await fetchCandidateTransactions(supabase, user.id);
  if (candidatesResult instanceof Response) return candidatesResult;
  const candidates = candidatesResult;

  const simulation = simulateRulesBatch(rulesToRun, candidates);

  if (dryRun) {
    const preview = simulation.results
      .filter((r) => r.modified)
      .slice(0, 50)
      .map((r) => ({
        transactionId: r.transactionId,
        original: r.original,
        updated: r.updated,
        matchedRuleId: r.matchedRuleId,
      }));

    return NextResponse.json({
      success: true,
      dryRun: true,
      totalEvaluated: simulation.totalEvaluated,
      matchedCount: simulation.matchedCount,
      modifiedCount: simulation.modifiedCount,
      preview,
    });
  }

  try {
    const clientIp = getClientIp(req);
    await writeAudit({
      userId: user.id,
      action: "rules_batch_applied",
      ip: clientIp,
      metadata: {
        phase: "attempt",
        totalEvaluated: simulation.totalEvaluated,
        matchedCount: simulation.matchedCount,
        modifiedCount: simulation.modifiedCount,
      },
    });

    const appliedCount = await applyBatchLivePersistence(
      simulation.results.filter((r) => r.modified),
      supabase,
      user.id,
      {
        ip: clientIp,
        totalEvaluated: simulation.totalEvaluated,
        matchedCount: simulation.matchedCount,
      },
    );

    await writeAudit({
      userId: user.id,
      action: "rules_batch_applied",
      ip: clientIp,
      metadata: {
        phase: "result",
        totalEvaluated: simulation.totalEvaluated,
        matchedCount: simulation.matchedCount,
        appliedCount,
      },
    });

    return NextResponse.json({
      success: true,
      dryRun: false,
      totalEvaluated: simulation.totalEvaluated,
      matchedCount: simulation.matchedCount,
      modifiedCount: simulation.modifiedCount,
      appliedCount,
    });
  } catch (error) {
    return errorResponse("rules.batch.post", error);
  }
}
