import type { NextRequest } from "next/server";
import { requireUser, badRequest, errorResponse } from "@/lib/http";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { readJsonBody } from "@/lib/request-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { validateConditions } from "@/lib/rule-conditions";
import { validateRuleActions } from "@/lib/rule-actions";
import {
  applyCompoundRules,
  loadRules,
  loadRuleCandidates,
  simulateCompoundRules,
  type StoredCompoundRule,
} from "@/lib/compound-rule-service";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { parseDate, isoDate } from "@/lib/date-utils";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isoDate(parseDate(value)) === value
  );
}
export async function GET() {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    if (!isFeatureEnabled("compoundRules"))
      return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({
      rules: await loadRules(auth.supabase, auth.user.id),
    });
  } catch (error) {
    return errorResponse("rules.compound.get", error);
  }
}
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;
    if (!isFeatureEnabled("compoundRules"))
      return Response.json({ error: "Not found" }, { status: 404 });
    if (
      !(await checkRateLimit(`rules:compound:${auth.user.id}`, 60, 3600, {
        failClosed: true,
      }))
    )
      return Response.json({ error: "Too many requests" }, { status: 429 });
    const body = await readJsonBody(req, 16384);
    if (body instanceof Response) return body;
    const value = body as Record<string, unknown> | null;
    if (!value || !["save", "preview", "apply"].includes(String(value.action)))
      return badRequest("Choose save, preview or apply");
    if (value.action === "save") return await saveRule(value, auth, req);
    return evaluateRules(value, auth, req);
  } catch (error) {
    return errorResponse("rules.compound.post", error);
  }
}

async function evaluateRules(
  value: Record<string, unknown>,
  auth: Exclude<Awaited<ReturnType<typeof requireUser>>, Response>,
  req: NextRequest,
) {
  if (!validDate(value.start) || !validDate(value.end) || value.start > value.end)
    return badRequest("Choose a valid date range");
  const candidates = await loadRuleCandidates(auth.supabase, auth.user.id, {
    start: value.start,
    end: value.end,
  });
  const rulesResult = await rulesForEvaluation(value, auth);
  if (rulesResult instanceof Response) return rulesResult;
  const rules = rulesResult;
  if (
    value.ruleId !== undefined &&
    (typeof value.ruleId !== "string" || !rules.some((rule) => rule.id === value.ruleId))
  )
    return badRequest("Invalid rule id");
  const simulation = simulateCompoundRules(rules, candidates);
  const changed = value.action === "apply"
    ? await applyCompoundRules(createServiceClient(), auth.user.id, "manual", rules, candidates, value.ruleId as string | undefined)
    : 0;
  if (value.action === "apply") invalidateDashboardCache(auth.user.id);
  await writeAudit({
    userId: auth.user.id,
    action: "rules_batch_applied",
    ip: getClientIp(req),
    metadata: { mode: value.action, evaluated: candidates.length, matched: simulation.matchedCount, changed },
  });
  return Response.json({ evaluated: candidates.length, matched: simulation.matchedCount, changed });
}

async function rulesForEvaluation(
  value: Record<string, unknown>,
  auth: Exclude<Awaited<ReturnType<typeof requireUser>>, Response>,
): Promise<StoredCompoundRule[] | Response> {
  const rules = await loadRules(auth.supabase, auth.user.id);
  if (value.conditions === undefined) return rules;
  if (value.action !== "preview" || !validateConditions(value.conditions))
    return badRequest("Invalid preview conditions");
  return [{
    id: "preview",
    match_type: "compound" as const,
    pattern: "compound",
    conditions: value.conditions,
    actions: { category: "Preview" },
    enabled: true,
    tags: [],
    category: null,
    display_name: null,
    amount_condition: null,
  }];
}
async function saveRule(
  value: Record<string, unknown>,
  auth: Exclude<Awaited<ReturnType<typeof requireUser>>, Response>,
  req: NextRequest,
) {
  if (
    !validateConditions(value.conditions) ||
    !validateRuleActions(value.actions)
  )
    return badRequest(
      "Invalid conditions or actions (three group levels and twenty leaves maximum)",
    );
  if (
    value.id !== undefined &&
    (typeof value.id !== "string" || !uuid.test(value.id))
  )
    return badRequest("Invalid rule id");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    return badRequest("Enabled must be boolean");
  const writer = createServiceClient();
  const payload = {
    conditions: value.conditions,
    actions: value.actions,
    match_type: "compound",
    pattern: "compound",
    enabled: value.enabled !== false,
  };
  let result;
  if (value.id) {
    const existing = (await loadRules(auth.supabase, auth.user.id)).find(
      (rule) => rule.id === value.id,
    );
    if (!existing)
      return Response.json({ error: "Not found" }, { status: 404 });
    result = await writer
      .from("merchant_rules")
      .update(payload)
      .eq("user_id", auth.user.id)
      .eq("id", value.id)
      .select("id")
      .single();
  } else {
    if ((await loadRules(auth.supabase, auth.user.id)).length >= 100)
      return badRequest("At most 100 rules are supported");
    result = await writer
      .from("merchant_rules")
      .insert({ ...payload, user_id: auth.user.id })
      .select("id")
      .single();
  }
  if (result.error) throw result.error;
  await writeAudit({
    userId: auth.user.id,
    action: "compound_rule_saved",
    ip: getClientIp(req),
    metadata: { rule_id: result.data.id },
  });
  invalidateDashboardCache(auth.user.id);
  return Response.json(result.data);
}
