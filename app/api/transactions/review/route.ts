import { NextRequest, NextResponse } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MAX_PAYLOAD_BYTES,
  validateReviewBatchPayload,
  type TransactionReviewResult,
} from "@/lib/transaction-review";

/**
 * Map a Postgres error from the atomic RPC to an HTTP response. Returns null
 * for an error the route should treat as unexpected (500).
 */
function rpcErrorResponse(error: { code?: string; message?: string }): NextResponse | null {
  // transaction_not_found: missing, foreign, or deleted id. One 404, no id disclosed.
  if (error.code === "P0002") {
    return NextResponse.json(
      { error: "One or more selected transactions are unavailable" },
      { status: 404 },
    );
  }

  // Stale version, newly pending entry, or new exclusion.
  if (error.code === "40001" || error.message?.includes("REVIEW_STATE_CHANGED")) {
    return NextResponse.json(
      {
        error: "These transactions changed. Review the updated entries before trying again.",
        code: "REVIEW_STATE_CHANGED",
      },
      { status: 409 },
    );
  }

  // Validation failure raised by the plpgsql checks.
  if (error.code === "22023") {
    return badRequest(error.message ?? "Invalid review request");
  }

  return null;
}

async function handlePatch(request: NextRequest) {

  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  // Rate limit: 120 requests per hour per user
  const allowed = await checkRateLimit(
    `txn_review:${user.id}`,
    120,
    3600,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many review requests. Please try again later." },
      { status: 429 },
    );
  }

  if (!isFeatureEnabled("transactionReview")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await readReviewBody(request);
  if (body instanceof NextResponse) return body;

  const validation = validateReviewBatchPayload(body);
  if (!validation.valid) {
    return badRequest(validation.error);
  }

  const { status, items } = validation.data;

  try {
    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient.rpc(
      "set_transaction_review_state_atomic",
      {
        p_user_id: user.id,
        p_status: status,
        p_items: items,
      },
    );

    if (error) {
      const mapped = rpcErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }

    const result = data as TransactionReviewResult;

    // Record audit: only counts and status, no personal transaction payload
    const auditAction =
      status === "reviewed"
        ? "transaction_reviewed"
        : "transaction_review_reopened";

    try {
      await writeAudit({
        userId: user.id,
        action: auditAction,
        metadata: {
          updated: result.updated,
          unchanged: result.unchanged,
          count: items.length,
          status,
        },
        ip: getClientIp(request),
      });
    } catch {
      // Audit failure after commit must not fail the financial-write response
    }

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("api.transactions.review", error);
  }
}

async function readReviewBody(request: NextRequest): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_PAYLOAD_BYTES) return badRequest("Payload exceeds maximum size");
  const reader = request.body?.getReader();
  if (!reader) return badRequest("Invalid JSON payload");
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAYLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        return badRequest("Payload exceeds maximum size");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    await reader.cancel().catch(() => undefined);
    return badRequest("Invalid JSON payload");
  } finally {
    reader.releaseLock();
  }
}

export async function PATCH(request: NextRequest) {
  let response: NextResponse;
  try {
    response = await handlePatch(request);
  } catch (error) {
    response = errorResponse("api.transactions.review", error);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
