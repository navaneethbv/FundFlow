import { NextResponse, type NextRequest } from "next/server";
import { requireUser, badRequest } from "@/lib/http";
import { getItem } from "@/lib/plaid-service";
import { checkRateLimit } from "@/lib/rate-limit";
import type { PlaidItemRow } from "@/lib/types";

/**
 * Shared scaffolding for POST handlers that act on one of the caller's Plaid
 * items identified by `item_id` in the JSON body. Resolves the authenticated
 * user, parses and validates the body, rate-limits, and loads the owned item.
 *
 * Returns `{ ok: true, user, item }` when every gate passes, otherwise
 * `{ ok: false, response }` with a NextResponse the caller returns directly.
 * Call it inside the route's try/catch: `getItem` (a network/DB read) can
 * still throw, and the caller's `errorResponse` must handle that.
 */
export type OwnedItemResult =
  | {
      ok: true;
      user: { id: string };
      item: PlaidItemRow;
    }
  | { ok: false; response: NextResponse };

export async function requireOwnedItem(
  request: NextRequest,
  options: {
    rateLimitKey: (userId: string) => string;
  },
): Promise<OwnedItemResult> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) {
    return { ok: false, response: auth };
  }
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: badRequest("Invalid JSON body") };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: badRequest("Invalid JSON body") };
  }
  const itemId = (body as { item_id?: unknown }).item_id;
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { ok: false, response: badRequest("item_id is required") };
  }

  if (!(await checkRateLimit(options.rateLimitKey(user.id), 10, 60))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    };
  }

  const item = await getItem(user.id, itemId);
  if (!item) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Item not found" }, { status: 404 }),
    };
  }

  return { ok: true, user, item };
}
