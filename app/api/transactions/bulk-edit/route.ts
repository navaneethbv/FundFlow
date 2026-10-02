import { NextRequest, NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { writeAudit, getClientIp } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const MAX_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("bulkEdit")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;
  if (!(await checkRateLimit(`txn_bulk_edit:${user.id}`, 60, 3600))) {
    return NextResponse.json({ error: "Too many bulk edit requests" }, { status: 429 });
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      transaction_ids?: unknown;
      action?: unknown;
      value?: unknown;
      versions?: unknown;
    } | null;
    const ids = Array.isArray(body?.transaction_ids)
      ? [...new Set(body.transaction_ids.filter((id): id is string => typeof id === "string" && UUID.test(id)))]
      : [];
    if (ids.length === 0 || ids.length > MAX_BATCH) return badRequest(`Between 1 and ${MAX_BATCH} transaction ids required`);
    const action = body?.action;
    if (action !== "tag" && action !== "category" && action !== "exclude" && action !== "reviewed" && action !== "collection") {
      return badRequest("Unsupported bulk edit action");
    }
    if (action === "reviewed" && !isFeatureEnabled("transactionReview")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const value = typeof body?.value === "string" ? body.value.trim().slice(0, 100) : "";
    if ((action === "tag" || action === "category" || action === "collection") && !value) {
      return badRequest("This action requires a value");
    }
    const { data: owned, error: ownedError } = await supabase
      .from("transactions")
      .select("id")
      .eq("user_id", user.id)
      .in("id", ids);
    if (ownedError) throw ownedError;
    const ownedIds = (owned ?? []).map((row) => String(row.id));
    if (ownedIds.length === 0) return NextResponse.json({ updated: 0 });

    const service = createServiceClient();
    if (action === "reviewed") {
      const versions = new Map(
        (Array.isArray(body?.versions) ? body.versions : [])
          .filter((item): item is { id: string; version: string } => Boolean(item && typeof item === "object" && UUID.test(String((item as { id?: unknown }).id)) && typeof (item as { version?: unknown }).version === "string"))
          .map((item) => [item.id, item.version]),
      );
      const items = ownedIds.map((id) => ({ transaction_id: id, expected_version: versions.get(id) ?? "1" }));
      const { error } = await service.rpc("set_transaction_review_state_atomic", {
        p_user_id: user.id,
        p_status: "reviewed",
        p_items: items,
      });
      if (error) throw error;
    } else {
      const { data: existing, error: existingError } = await service
        .from("transaction_annotations")
        .select("transaction_id,note,tags,display_category,cash_flow_classification,cleared_at,goal_id,rule_actions")
        .eq("user_id", user.id)
        .in("transaction_id", ownedIds);
      if (existingError) throw existingError;
      const byId = new Map((existing ?? []).map((row) => [String(row.transaction_id), row as Record<string, unknown>]));
      const upserts = ownedIds.map((id) => {
        const current = byId.get(id) ?? {};
        const tags = Array.isArray(current.tags) ? current.tags.filter((tag): tag is string => typeof tag === "string") : [];
        if (action === "tag") tags.push(value.toLowerCase());
        if (action === "collection") tags.push(`collection:${value}`);
        return {
          user_id: user.id,
          transaction_id: id,
          note: typeof current.note === "string" ? current.note : "",
          tags: [...new Set(tags)].slice(0, 12),
          display_category: action === "category" ? value : (current.display_category ?? null),
          cash_flow_classification: current.cash_flow_classification ?? null,
          cleared_at: current.cleared_at ?? null,
          goal_id: current.goal_id ?? null,
          rule_actions: action === "exclude"
            ? { ...(current.rule_actions && typeof current.rule_actions === "object" ? current.rule_actions : {}), exclude: true }
            : (current.rule_actions ?? null),
        };
      });
      const { error } = await service.from("transaction_annotations").upsert(upserts, { onConflict: "user_id,transaction_id" });
      if (error) throw error;
    }
    invalidateDashboardCache(user.id);
    await writeAudit({ userId: user.id, action: "transaction_bulk_edit", metadata: { action, count: ownedIds.length }, ip: getClientIp(request) });
    return NextResponse.json({ updated: ownedIds.length });
  } catch (error) {
    return errorResponse("transactions.bulk-edit", error);
  }
}
