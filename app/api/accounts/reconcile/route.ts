import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp, writeAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { invalidateDashboardCache } from "@/lib/dashboard-cache";
import { parseAccountRef } from "@/lib/reconcile";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 999999999999.99;
}
function parseInput(body: Record<string, unknown>) {
  const ref = parseAccountRef(body.account);
  if (!ref || !UUID.test(ref.id) || !validDate(body.statement_date)) return null;
  const openingDate = body.opening_date ?? null;
  const openingBalance = body.opening_balance ?? null;
  if (openingDate !== null && !validDate(openingDate)) return null;
  if (openingBalance !== null && !validMoney(openingBalance)) return null;
  if ((openingDate === null) !== (openingBalance === null)) return null;
  return { p_source: ref.source, p_account_id: ref.id, p_statement_date: body.statement_date,
    p_opening_date: openingDate, p_opening_balance: openingBalance };
}
function rpcError(error: { code?: string; message: string }) {
  if (error.code === "40001") return NextResponse.json({ error: error.message }, { status: 409 });
  if (error.code === "22023") return badRequest(error.message);
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const params = request.nextUrl.searchParams;
    const openingBalance = params.get("opening_balance");
    const input = parseInput({ account: params.get("account"), statement_date: params.get("statement_date"),
      opening_date: params.get("opening_date"), opening_balance: openingBalance === null ? null : Number(openingBalance) });
    if (!input) return badRequest("Invalid statement or opening balance");
    const { data, error } = await auth.supabase.rpc("get_reconciliation_preview", input);
    if (error) { const response = rpcError(error); if (response) return response; throw error; }
    if (!data) throw new Error("Reconciliation preview unavailable");
    return NextResponse.json(data);
  } catch (error) { return errorResponse("accounts.reconcile.read", error); }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!(await checkRateLimit(`reconcile:${auth.user.id}:write`, 30, 3600))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("Invalid reconciliation");
    const input = parseInput(body);
    if (!input || !validMoney(body.statement_balance) || typeof body.request_id !== "string" || !UUID.test(body.request_id)
      || typeof body.revision !== "string" || !/^[a-f0-9]{32}$/.test(body.revision)
      || !Array.isArray(body.cleared_ids) || body.cleared_ids.length > 10000
      || body.cleared_ids.some((id: unknown) => typeof id !== "string" || !UUID.test(id))
      || typeof body.create_adjustment !== "boolean") return badRequest("Invalid reconciliation");
    const { data, error } = await createServiceClient().rpc("save_reconciliation_atomic", {
      ...input, p_user_id: auth.user.id, p_statement_balance: body.statement_balance,
      p_cleared_ids: body.cleared_ids, p_revision: body.revision, p_request_id: body.request_id,
      p_create_adjustment: body.create_adjustment,
    });
    if (error) { const response = rpcError(error); if (response) return response; throw error; }
    if (!data) throw new Error("Reconciliation save unavailable");
    invalidateDashboardCache(auth.user.id);
    await writeAudit({ userId: auth.user.id, action: "account_reconciled", metadata: {
      account: body.account, statement_date: body.statement_date, request_id: body.request_id,
      adjustment_amount: data.adjustment_amount,
    }, ip: getClientIp(request) });
    return NextResponse.json(data);
  } catch (error) { return errorResponse("accounts.reconcile.write", error); }
}
