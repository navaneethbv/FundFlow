import { NextResponse, type NextRequest } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveViewerToday } from "@/lib/report-period";
import { loadPrivateLendingData } from "@/lib/private-lending-data";
import { validatePrivateLoanDraft } from "@/lib/private-lending";
import { createServiceClient } from "@/lib/supabase/service";
import { getClientIp, writeAudit } from "@/lib/audit";
import { validFinancialDate } from "@/lib/xirr";

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function createLoan(
  request: NextRequest,
  body: Record<string, unknown>,
  userId: string,
  service: ReturnType<typeof createServiceClient>,
): Promise<NextResponse> {
  const draft = validatePrivateLoanDraft(body);
  if (!draft.ok) return badRequest(draft.error);
  const { data, error } = await service.rpc("create_private_loan", {
    p_user_id: userId,
    p_direction: draft.value.direction,
    p_counterparty: draft.value.counterparty,
    p_principal: draft.value.principal,
    p_annual_interest_rate: draft.value.annualInterestRate,
    p_start_date: draft.value.startDate,
    p_due_date: draft.value.dueDate,
    p_notes: draft.value.notes,
  });
  if (error) throw error;
  await writeAudit({ userId, action: "private_loan_created", metadata: { loan_id: data }, ip: getClientIp(request) });
  return NextResponse.json({ ok: true, id: data });
}

async function recordPayment(
  request: NextRequest,
  body: Record<string, unknown>,
  userId: string,
  service: ReturnType<typeof createServiceClient>,
): Promise<NextResponse> {
  if (!isUuid(body.loan_id) || !validFinancialDate(body.payment_date)) {
    return badRequest("loan_id and payment_date are required");
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    return badRequest("Payment amount must be positive and bounded");
  }
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 500)) {
    return badRequest("Payment note must be at most 500 characters");
  }
  const { data, error } = await service.rpc("record_private_loan_payment", {
    p_user_id: userId,
    p_loan_id: body.loan_id,
    p_payment_date: body.payment_date,
    p_amount: Math.round(amount * 100) / 100,
    p_note: typeof body.note === "string" ? body.note : null,
  });
  if (error) {
    if (error.code === "P0002") return NextResponse.json({ error: "Private loan not found" }, { status: 404 });
    if (error.code === "22023") return badRequest(error.message);
    throw error;
  }
  await writeAudit({ userId, action: "private_loan_payment_recorded", metadata: { loan_id: body.loan_id }, ip: getClientIp(request) });
  return NextResponse.json({ ok: true, result: data });
}

export async function GET() {
  if (!isFeatureEnabled("privateLending")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const today = await resolveViewerToday(auth.supabase, auth.user.id);
    return NextResponse.json(await loadPrivateLendingData(auth.supabase, auth.user.id, today), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse("private-lending.get", error);
  }
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled("privateLending")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!(await checkRateLimit(`private-lending:${auth.user.id}`, 30, 3600, { failClosed: true }))) {
    return NextResponse.json({ error: "Too many private lending updates. Please try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const service = createServiceClient();
    // Awaited so a rejected RPC reaches errorResponse rather than escaping the try.
    if (body?.kind === "loan") return await createLoan(request, body, auth.user.id, service);
    if (body?.kind === "payment") return await recordPayment(request, body, auth.user.id, service);
    return badRequest("kind must be loan or payment");
  } catch (error) {
    return errorResponse("private-lending.post", error);
  }
}
