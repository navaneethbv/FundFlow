import { NextResponse } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_AMOUNT = 1_000_000_000;

type MoveBody = { month?: unknown; from_budget_id?: unknown; to_budget_id?: unknown; amount?: unknown } | null;
type ParsedMove = { month: string; fromId: string; toId: string; amount: number };

function validAmount(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount < MAX_AMOUNT
    && Number(amount.toFixed(2)) === amount;
}

function parseMove(body: MoveBody): ParsedMove | string {
  if (typeof body?.month !== "string" || !MONTH.test(body.month)) return "Choose a valid month";
  const fromId = body.from_budget_id;
  const toId = body.to_budget_id;
  if (typeof fromId !== "string" || !UUID.test(fromId) || typeof toId !== "string" || !UUID.test(toId)) return "Choose two budgets";
  if (fromId === toId) return "Choose two different budgets";
  if (!validAmount(body.amount)) return "Enter a positive amount with at most two decimals";
  return { month: body.month, fromId, toId, amount: body.amount };
}

/**
 * Reference adoption 7.1: move planned money from one category budget to
 * another for a month. The service-only RPC owns the atomic write, the owner
 * check, the overdraw refusal, and the history row.
 */
export async function POST(request: Request) {
  if (!isFeatureEnabled("budgetMoves")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;
  if (!(await checkRateLimit(`budget_move:${user.id}`, 60, 3600))) {
    return NextResponse.json({ error: "Too many budget moves. Try again later." }, { status: 429 });
  }
  try {
    const parsed = parseMove((await request.json().catch(() => null)) as MoveBody);
    if (typeof parsed === "string") return badRequest(parsed);
    const { error } = await createServiceClient().rpc("move_budget_amount", {
      p_user_id: user.id,
      p_month: `${parsed.month}-01`,
      p_from_budget_id: parsed.fromId,
      p_to_budget_id: parsed.toId,
      p_amount: parsed.amount,
    });
    if (error?.code === "22023") return badRequest(error.message ?? "Invalid budget move");
    if (error?.code === "P0002") return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    if (error) throw error;
    invalidateDashboardCache(user.id);
    await writeAudit({
      userId: user.id,
      action: "budget_money_moved",
      metadata: { month: parsed.month, from_budget_id: parsed.fromId, to_budget_id: parsed.toId, amount: parsed.amount },
      ip: getClientIp(request),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("budget.move", error);
  }
}
