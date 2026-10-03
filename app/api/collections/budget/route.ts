import { NextResponse } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";

type BudgetBody = { name?: unknown; budget?: unknown } | null;

function validBudget(budget: unknown): budget is number {
  return typeof budget === "number" && Number.isFinite(budget) && budget >= 0 && budget < 1_000_000_000_000
    && Math.round(budget * 100) === budget * 100;
}

function parseBudget(body: BudgetBody): { name: string; budget: number | null } | string {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) return "Collection name must be 1 to 80 characters";
  if (body?.budget === null) return { name, budget: null };
  if (!validBudget(body?.budget)) return "Budget must be zero or more with at most two decimals";
  return { name, budget: body.budget };
}

/**
 * Reference adoption 6.8: set or clear a collection's optional budget. The
 * table is user-authored configuration, so the cookie client writes it under
 * owner RLS; a null budget removes the row.
 */
export async function PUT(request: Request) {
  if (!isFeatureEnabled("transactionCollections")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  try {
    const parsed = parseBudget((await request.json().catch(() => null)) as BudgetBody);
    if (typeof parsed === "string") return badRequest(parsed);
    const { error } = parsed.budget === null
      ? await supabase.from("transaction_collections").delete().eq("user_id", user.id).eq("name", parsed.name)
      : await supabase.from("transaction_collections").upsert(
          { user_id: user.id, name: parsed.name, budget: parsed.budget },
          { onConflict: "user_id,name" },
        );
    if (error) throw error;
    await writeAudit({
      userId: user.id,
      action: "collection_budget_updated",
      metadata: { cleared: parsed.budget === null },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("collections.budget", error);
  }
}
