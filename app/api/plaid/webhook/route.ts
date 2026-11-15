import { after, NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getClientIp } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPlaidReconnectWarning, requiresPlaidUserAction } from "@/lib/plaid-item-health";
import { safeEqual } from "@/lib/crypto";
import { getPlaidClient } from "@/lib/plaid";
import { syncItemTransactions } from "@/lib/sync";
import { refreshRecurringForItem } from "@/lib/recurring";
import { refreshInferredRecurringForItem } from "@/lib/recurring-inference";
import { syncInvestmentsForItem } from "@/lib/investment-sync";
import { getItemByPlaidItemId, setItemStatus, setNewAccountsAvailable } from "@/lib/plaid-service";
import { errorResponse, badRequest } from "@/lib/http";
import { logError } from "@/lib/log";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Plaid webhook payloads are small JSON documents. Bound the unauthenticated
// request body before signature verification so an attacker cannot make a
// serverless invocation buffer an arbitrarily large body in memory.
const MAX_WEBHOOK_BYTES = 256 * 1024;

function payloadTooLarge(): NextResponse {
  return NextResponse.json(
    { error: "Webhook payload exceeds maximum size" },
    { status: 413 },
  );
}

async function readWebhookBody(req: NextRequest): Promise<string | NextResponse> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return payloadTooLarge();
  }

  const reader = req.body?.getReader();
  if (!reader) return "";

  // Decode leniently, like `req.text()`: malformed bytes from an
  // unauthenticated sender then fail signature verification (401) instead of
  // throwing into the 500 error path.
  const decoder = new TextDecoder("utf-8");
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        return payloadTooLarge();
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Verification keys cached by kid (Plaid's documented recommendation) so
 * steady-state webhooks cost zero extra Plaid calls. Keys marked expired are
 * never cached, so rotation falls through to a fresh fetch. Module-level →
 * per warm serverless instance, which is exactly the lifetime we want.
 */
const webhookKeyCache = new Map<string, { key: crypto.KeyObject | null; expires: number }>();
const MAX_CACHED_KEYS = 128;

function cacheWebhookKey(kid: string, key: crypto.KeyObject | null, ttl: number): void {
  if (webhookKeyCache.size >= MAX_CACHED_KEYS) {
    const oldest = webhookKeyCache.keys().next().value;
    if (oldest !== undefined) webhookKeyCache.delete(oldest);
  }
  webhookKeyCache.set(kid, { key, expires: Date.now() + ttl });
}

async function getWebhookVerificationKey(kid: string, request: NextRequest): Promise<crypto.KeyObject | null> {
  const cached = webhookKeyCache.get(kid);
  if (cached && cached.expires > Date.now()) return cached.key;
  webhookKeyCache.delete(kid);

  const ipHash = crypto.createHash("sha256").update(getClientIp(request) ?? "unknown").digest("hex");
  if (!await checkRateLimit(`plaid-webhook-key:${ipHash}`, 30, 60, { failClosed: true })) return null;

  try {
    const response = await getPlaidClient().webhookVerificationKeyGet({ key_id: kid });
    const jwk = response.data.key;
    if (!jwk || jwk.expired_at) {
      cacheWebhookKey(kid, null, 5 * 60_000);
      return null;
    }
    const key = crypto.createPublicKey({ format: "jwk", key: { ...jwk } });
    cacheWebhookKey(kid, key, 60 * 60_000);
    return key;
  } catch (error) {
    const provider = (error as { response?: { status?: number; data?: { error_code?: string } } })?.response;
    if (provider?.status === 400 || provider?.status === 404) {
      cacheWebhookKey(kid, null, 5 * 60_000);
    } else {
      logError("webhook.key-fetch", "Verification key unavailable");
    }
    return null;
  }
}

async function verifyPlaidWebhook(req: NextRequest, bodyText: string): Promise<boolean> {
  // Fail closed: verification is only ever skipped in non-production setups
  // that explicitly run against Plaid sandbox. In production — and whenever
  // PLAID_ENV is anything other than "sandbox" — every webhook must carry a
  // valid signature. An unset PLAID_ENV must not silently disable verification.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.PLAID_ENV === "sandbox"
  ) {
    return true;
  }

  const verificationHeader = req.headers.get("plaid-verification");
  if (!verificationHeader) return false;

  try {
    const parts = verificationHeader.split(".");
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
    const { kid, alg } = header;
    if (typeof kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(kid) || alg !== "ES256") return false;
    const signature = Buffer.from(signatureB64, "base64url");
    if (signature.length !== 64) return false;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    const issuedAt = payload.iat;
    if (!Number.isFinite(issuedAt) || Math.abs(Date.now() / 1000 - issuedAt) > 5 * 60) return false;
    const bodyHash = crypto.createHash("sha256").update(bodyText).digest("hex");
    if (typeof payload.request_body_sha256 !== "string" || !safeEqual(payload.request_body_sha256, bodyHash)) return false;

    const publicKey = await getWebhookVerificationKey(kid, req);
    if (!publicKey) return false;
    return crypto.verify("sha256", Buffer.from(`${headerB64}.${payloadB64}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
}

async function handleTransactionWebhook(body: {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
}): Promise<void> {
  if (
    body.webhook_type !== "TRANSACTIONS" ||
    body.webhook_code !== "SYNC_UPDATES_AVAILABLE" ||
    typeof body.item_id !== "string" ||
    body.item_id.length === 0
  ) return;
  const item = await getItemByPlaidItemId(body.item_id);
  if (!item || item.status === "disconnected") return;
  // Inference reads the canonical ledger, so it only runs once the sync that
  // populates that ledger has succeeded.
  await syncItemTransactions(item);
  await runBestEffortWebhookStep("webhook.transactions.inference", () =>
    refreshInferredRecurringForItem(item),
  );
}

async function runBestEffortWebhookStep(
  context: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    logError(context, error);
  }
}

/**
 * Plaid recomputed this item's recurring streams. Refresh the provider rows
 * first so the Plaid-first deduplication in inference sees the current
 * snapshot, then reconcile the locally inferred rows against it. Transactions
 * are not re-synced here: this webhook says the streams changed, not the
 * ledger.
 */
async function handleRecurringWebhook(body: {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
}): Promise<void> {
  if (
    body.webhook_type !== "TRANSACTIONS" ||
    body.webhook_code !== "RECURRING_TRANSACTIONS_UPDATE" ||
    typeof body.item_id !== "string" ||
    body.item_id.length === 0
  ) return;
  const item = await getItemByPlaidItemId(body.item_id);
  if (!item) return;
  await runBestEffortWebhookStep("webhook.recurring.provider", () =>
    refreshRecurringForItem(item),
  );
  await runBestEffortWebhookStep("webhook.recurring.inference", () =>
    refreshInferredRecurringForItem(item),
  );
}

async function handleHoldingsWebhook(body: {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
}): Promise<void> {
  if (
    body.webhook_type !== "HOLDINGS" ||
    (body.webhook_code !== "DEFAULT_UPDATE" &&
      body.webhook_code !== "HISTORICAL_UPDATE") ||
    typeof body.item_id !== "string" ||
    !isFeatureEnabled("investmentsPage")
  ) return;
  const item = await getItemByPlaidItemId(body.item_id);
  if (item) {
    await syncInvestmentsForItem(item).catch((err) =>
      logError("webhook.holdings", err),
    );
  }
}

async function handleItemWebhook(body: {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
  error?: { error_code?: unknown };
}): Promise<void> {
  if (
    body.webhook_type !== "ITEM" ||
    typeof body.item_id !== "string" ||
    body.item_id.length === 0
  ) return;
  const item = await getItemByPlaidItemId(body.item_id);
  if (!item || item.status === "disconnected") return;
  if (body.webhook_code === "ERROR") {
    const code =
      typeof body.error?.error_code === "string"
        ? body.error.error_code
        : "ITEM_ERROR";
    if (requiresPlaidUserAction(code)) {
      await setItemStatus(item.user_id, item.id, "error", code);
    } else if (!requiresPlaidUserAction(item.error_code) && !isPlaidReconnectWarning(item.error_code)) {
      await setItemStatus(item.user_id, item.id, item.status, code);
    }
  } else if (body.webhook_code === "PENDING_EXPIRATION" || body.webhook_code === "PENDING_DISCONNECT") {
    if (item.status === "active") await setItemStatus(item.user_id, item.id, "active", body.webhook_code);
  } else if (body.webhook_code === "NEW_ACCOUNTS_AVAILABLE") {
    await setNewAccountsAvailable(item.user_id, item.id, true);
  } else if (body.webhook_code === "LOGIN_REPAIRED") {
    await setItemStatus(item.user_id, item.id, "active", null);
  } else if (body.webhook_code === "USER_PERMISSION_REVOKED") {
    await setItemStatus(item.user_id, item.id, "disconnected", "USER_PERMISSION_REVOKED");
  }
}

const HANDLED_WEBHOOKS = new Set([
  "TRANSACTIONS:RECURRING_TRANSACTIONS_UPDATE",
  "HOLDINGS:DEFAULT_UPDATE", "HOLDINGS:HISTORICAL_UPDATE",
  "ITEM:ERROR", "ITEM:PENDING_EXPIRATION", "ITEM:PENDING_DISCONNECT",
  "ITEM:NEW_ACCOUNTS_AVAILABLE", "ITEM:LOGIN_REPAIRED", "ITEM:USER_PERMISSION_REVOKED",
]);
const loggedWebhookCodes = new Set<string>();

function logUnhandledWebhook(type: unknown, code: unknown): void {
  if (typeof type !== "string" || typeof code !== "string" ||
      !/^[A-Z0-9_]{1,64}$/.test(type) || !/^[A-Z0-9_]{1,64}$/.test(code)) return;
  const pair = `${type}:${code}`;
  if (HANDLED_WEBHOOKS.has(pair) || loggedWebhookCodes.has(pair) || loggedWebhookCodes.size >= 128) return;
  loggedWebhookCodes.add(pair);
  console.info("[webhook.unhandled]", pair);
}

/**
 * Handles incoming Plaid webhooks. Syncs transactions on demand when Plaid notifies
 * us that new sync updates are available.
 */
export async function POST(req: NextRequest) {
  try {
    const bodyText = await readWebhookBody(req);
    if (bodyText instanceof NextResponse) return bodyText;
    const isVerified = await verifyPlaidWebhook(req, bodyText);
    if (!isVerified) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(bodyText) as {
      webhook_type?: unknown;
      webhook_code?: unknown;
      item_id?: unknown;
      error?: { error_code?: unknown };
    };

    if (
      body.webhook_type === "TRANSACTIONS" &&
      (body.webhook_code === "SYNC_UPDATES_AVAILABLE" ||
        body.webhook_code === "RECURRING_TRANSACTIONS_UPDATE")
    ) {
      if (!body.item_id) {
        return badRequest("Missing item_id in webhook body");
      }
    }

    // Holdings changed (or the initial historical pull finished): a bounded,
    // item-scoped refresh. Gated on investmentsPage — before its migration is
    // applied, `holdings` doesn't exist to write to.
    if (body.webhook_type === "TRANSACTIONS" && body.webhook_code === "SYNC_UPDATES_AVAILABLE") {
      after(() => runBestEffortWebhookStep("webhook.transactions", () => handleTransactionWebhook(body)));
      return NextResponse.json({ success: true });
    }

    await handleRecurringWebhook(body);
    await handleHoldingsWebhook(body);

    // ITEM lifecycle: mark broken connections so Settings can offer the
    // update-mode "Reconnect" flow, and clear the flag when Plaid says the
    // login was repaired on its own.
    await handleItemWebhook(body);
    logUnhandledWebhook(body.webhook_type, body.webhook_code);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse("api/plaid/webhook", err);
  }
}
