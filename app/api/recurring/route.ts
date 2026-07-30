import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit, type AuditAction } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ["review", "dismiss", "restore", "correct_amount"] as const;
type RecurringAction = (typeof ACTIONS)[number];

const AUDIT_ACTION_FOR: Record<RecurringAction, AuditAction> = {
  review: "recurring_stream_reviewed",
  dismiss: "recurring_stream_dismissed",
  restore: "recurring_stream_restored",
  correct_amount: "recurring_stream_amount_corrected",
};

interface PatchBody {
  stream_id: string;
  action: RecurringAction;
  amount?: number;
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

function parseBody(value: unknown): { ok: true; value: PatchBody } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid JSON payload" };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.stream_id !== "string" || !UUID_REGEX.test(body.stream_id)) {
    return { ok: false, message: "Invalid stream_id" };
  }
  if (typeof body.action !== "string" || !ACTIONS.includes(body.action as RecurringAction)) {
    return { ok: false, message: "Invalid action" };
  }
  if (body.action === "correct_amount") {
    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      body.amount < 0 ||
      !hasAtMostTwoDecimals(body.amount)
    ) {
      return { ok: false, message: "Invalid amount" };
    }
  }
  return {
    ok: true,
    value: {
      stream_id: body.stream_id,
      action: body.action as RecurringAction,
      amount: body.amount as number | undefined,
    },
  };
}

function patchFor(action: RecurringAction, amount: number | undefined): Record<string, unknown> {
  const now = new Date().toISOString();
  if (action === "review") return { reviewed_at: now };
  if (action === "dismiss") return { dismissed_at: now };
  if (action === "restore") return { dismissed_at: null };
  return { user_amount: amount };
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const parsed = parseBody(await request.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.message);
    const { stream_id: streamId, action, amount } = parsed.value;

    // recurring_streams is a Plaid-synced table and is intentionally not
    // client-writable (RLS has a SELECT-only policy — see CLAUDE.md's "client
    // writes allowed only on budgets and the profiles preference columns"
    // invariant). requireUser() only establishes identity here; the actual
    // write goes through the service client, same as every other
    // Plaid-synced-table write in this app (plaid-service.ts, sync.ts,
    // app/api/plaid/disconnect/route.ts). The explicit .eq("user_id", ...)
    // scope below is what enforces ownership, since the service client
    // bypasses RLS entirely.
    const service = createServiceClient();
    const { data, error } = await service
      .from("recurring_streams")
      .update(patchFor(action, amount))
      .eq("id", streamId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return errorResponse("recurring.update", error);
    if (!data) {
      return NextResponse.json({ error: "Recurring stream not found" }, { status: 404 });
    }

    await writeAudit({
      userId: user.id,
      action: AUDIT_ACTION_FOR[action],
      metadata: { stream_id: streamId },
    });

    return NextResponse.json({ stream_id: streamId, action });
  } catch (error) {
    return errorResponse("recurring.update", error);
  }
}
