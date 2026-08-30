import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, requireUser, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";
import { getPlaidClient } from "@/lib/plaid";
import {
  decryptItemTokenAndUpgrade,
  getItem,
  setItemStatus,
} from "@/lib/plaid-service";
import {
  backfillItemTransactions,
  ItemSyncInProgressError,
} from "@/lib/sync";
import {
  classifyRepairError,
  repairMessage,
  REPAIR_MAX_ATTEMPTS,
  REPAIR_MAX_PAGES,
  REPAIR_WINDOW_SECONDS,
  type RepairFailureKind,
} from "@/lib/repair";
import { safeErrorCode } from "@/lib/cursor-health";

function providerOutcome(kind: RepairFailureKind) {
  const message = repairMessage(kind);
  if (kind === "rate_limited") {
    return NextResponse.json(
      { ok: false, status: kind, message },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { ok: false, status: kind, message },
    { status: kind === "generic_failure" ? 500 : 200 },
  );
}

async function parseItemId(
  request: NextRequest,
): Promise<{ itemId: string } | { response: NextResponse }> {
  let itemId: unknown = null;
  try {
    const body = (await request.json()) as { itemId?: unknown } | null;
    itemId = body?.itemId;
  } catch {
    return { response: badRequest("Invalid JSON body") };
  }
  return typeof itemId === "string" && itemId.length > 0
    ? { itemId }
    : { response: badRequest("Missing itemId") };
}

type RepairItem = NonNullable<Awaited<ReturnType<typeof getItem>>>;

async function providerReadinessFailure(
  item: RepairItem,
): Promise<NextResponse | null> {
  try {
    const accessToken = await decryptItemTokenAndUpgrade(item);
    await getPlaidClient().itemGet({ access_token: accessToken });
    return null;
  } catch (error) {
    const kind = classifyRepairError(error);
    const errResponse = (error as { response?: { data?: { error_code?: unknown } } } | null)
      ?.response;
    const rawCode = errResponse?.data?.error_code;
    const safeCode = safeErrorCode(typeof rawCode === "string" ? rawCode : null);
    if (
      safeCode &&
      (kind === "consent_required" || kind === "institution_login_required")
    ) {
      await setItemStatus(item.user_id, item.id, "error", safeCode).catch(
        (statusError) => logError("plaid.repair.status", statusError),
      );
    }
    return providerOutcome(kind);
  }
}

function repairFailureOutcome(error: unknown): NextResponse {
  if (error instanceof ItemSyncInProgressError) {
    return NextResponse.json(
      {
        ok: false,
        status: "sync_in_progress",
        message: "A sync is already running for this institution. Try again shortly.",
      },
      { status: 409 },
    );
  }
  const kind = classifyRepairError(error);
  return kind === "generic_failure"
    ? errorResponse("plaid.repair", error)
    : providerOutcome(kind);
}

/**
 * Authenticated, rate-limited repair for one owned Plaid item.
 *
 * Confirms provider readiness via /item/get, then runs a bounded historical
 * reconciliation (up to REPAIR_MAX_PAGES). Never deletes local transactions
 * merely because a partial provider response omits them — only explicit Plaid
 * tombstones are applied, and only as part of the bounded backfill itself.
 *
 * Provider-conditional outcomes (product not ready, consent required,
 * institution login required) are surfaced distinctly so Settings can explain
 * what the user must do next instead of showing a generic failure.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  if (
    !(await checkRateLimit(
      `repair:${user.id}`,
      REPAIR_MAX_ATTEMPTS,
      REPAIR_WINDOW_SECONDS,
    ))
  ) {
    return NextResponse.json(
      { error: "Too many repair attempts. Please wait a moment before trying again." },
      { status: 429 },
    );
  }

  const parsedItemId = await parseItemId(request);
  if ("response" in parsedItemId) return parsedItemId.response;

  // Ownership is enforced by scoping the lookup to the authenticated user.
  const item = await getItem(user.id, parsedItemId.itemId);
  if (!item) {
    return NextResponse.json(
      { error: "Institution connection not found." },
      { status: 404 },
    );
  }

  try {
    // Provider readiness: /item/get confirms the token is live before we spend
    // a bounded backfill against it.
    const readinessFailure = await providerReadinessFailure(item);
    if (readinessFailure) return readinessFailure;

    const result = await backfillItemTransactions(item, { maxPages: REPAIR_MAX_PAGES });

    await writeAudit({
      userId: user.id,
      action: "plaid_repair",
      metadata: {
        itemId: item.id,
        pagesCompleted: result.pagesCompleted,
        maxPages: result.maxPages,
        completed: result.completed,
        added: result.added,
        modified: result.modified,
        removed: result.removed,
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({
      ok: true,
      status: result.completed ? "repaired" : "backfill_incomplete",
      ...result,
    });
  } catch (error) {
    return repairFailureOutcome(error);
  }
}
