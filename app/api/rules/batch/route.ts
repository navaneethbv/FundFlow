import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit, getClientIp } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  simulateRulesBatch,
  type SmartRule,
  type RuleTransactionCandidate,
} from "@/lib/rules-engine";

interface BatchRulesRequest {
  rules?: SmartRule[];
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
  merchant: string | null;
  name: string | null;
  amount: number | string;
  pfc_primary: string | null;
}

interface DbAnnotation {
  transaction_id: string;
  tags: string[] | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user, supabase } = auth;

  let body: BatchRulesRequest;
  try {
    body = (await req.json()) as BatchRulesRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const dryRun = body.dryRun !== false;

  // 1. Resolve rules: either provided in payload or fetched from database
  let rulesToRun: SmartRule[] = [];
  if (Array.isArray(body.rules) && body.rules.length > 0) {
    rulesToRun = body.rules;
  } else {
    const { data: dbRules, error: rulesError } = await supabase
      .from("merchant_rules")
      .select("id, match_type, pattern, display_name, category, enabled")
      .eq("user_id", user.id)
      .eq("enabled", true)
      .order("created_at", { ascending: true });

    if (rulesError) {
      return errorResponse("Failed to load rules: " + rulesError.message, 500);
    }

    const typedDbRules = (dbRules || []) as unknown as DbMerchantRule[];
    rulesToRun = typedDbRules.map((r) => ({
      id: r.id,
      matchType: r.match_type,
      pattern: r.pattern,
      displayName: r.display_name,
      category: r.category,
      enabled: r.enabled,
    }));
  }

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

  // 2. Fetch recent user transactions (capped at 500 for safety and performance)
  const { data: txns, error: txError } = await supabase
    .from("transactions")
    .select("id, merchant, name, amount, pfc_primary")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(500);

  if (txError) {
    return errorResponse("Failed to load transactions: " + txError.message, 500);
  }

  const typedTxns = (txns || []) as unknown as DbTransaction[];

  // 3. Fetch existing annotations for these transactions
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

  // 4. Build candidate list
  const candidates: RuleTransactionCandidate[] = typedTxns.map((t) => ({
    id: t.id,
    merchant: t.merchant,
    name: t.name,
    amount: Number(t.amount) || 0,
    category: t.pfc_primary,
    tags: annotationsMap.get(t.id) || [],
  }));

  // 5. Run rules simulation
  const simulation = simulateRulesBatch(rulesToRun, candidates);

  // 6. If dry run, return preview of modified items
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

  // 7. Live apply: bulk upsert tag changes & category remapping to transaction_annotations,
  // and update merchant renaming on transactions without N+1 query loops.
  let appliedCount = 0;
  const modifiedItems = simulation.results.filter((r) => r.modified);

  // A. Bulk upsert annotations (tags and display_category)
  const annotationRows = modifiedItems
    .filter(
      (r) =>
        r.updated.tags.length > 0 ||
        (r.updated.category && r.updated.category !== r.original.category),
    )
    .map((r) => ({
      user_id: user.id,
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

    if (!upsertError) {
      appliedCount += annotationRows.length;
    }
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
        .eq("user_id", user.id);

      if (!merchantError) {
        const notInAnnotations = ids.filter(
          (id) => !annotationRows.some((a) => a.transaction_id === id),
        );
        appliedCount += notInAnnotations.length;
      }
    }
  }

  await writeAudit({
    userId: user.id,
    action: "rules_batch_applied",
    ip: getClientIp(req),
    metadata: {
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
}
