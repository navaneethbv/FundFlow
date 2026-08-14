import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import { getPlaidClient } from "@/lib/plaid";
import { syncItemTransactions } from "@/lib/sync";
import { syncInvestmentsForItem } from "@/lib/investment-sync";
import { getItemByPlaidItemId, setItemStatus } from "@/lib/plaid-service";
import { errorResponse, badRequest } from "@/lib/http";
import { logError } from "@/lib/log";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * Verification keys cached by kid (Plaid's documented recommendation) so
 * steady-state webhooks cost zero extra Plaid calls. Keys marked expired are
 * never cached, so rotation falls through to a fresh fetch. Module-level →
 * per warm serverless instance, which is exactly the lifetime we want.
 */
const webhookKeyCache = new Map<string, crypto.KeyObject>();

async function getWebhookVerificationKey(kid: string): Promise<crypto.KeyObject> {
  const cached = webhookKeyCache.get(kid);
  if (cached) return cached;

  const plaid = getPlaidClient();
  const response = await plaid.webhookVerificationKeyGet({ key_id: kid });
  const jwk = response.data.key;
  const key = crypto.createPublicKey({
    format: "jwk",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    key: jwk as any,
  });
  if (!jwk.expired_at) {
    webhookKeyCache.set(kid, key);
  }
  return key;
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
    if (!kid) return false;
    // Pin the algorithm Plaid documents; never trust an attacker-chosen alg.
    if (alg !== "ES256") return false;

    const publicKey = await getWebhookVerificationKey(kid);

    // JWS ES256 signatures are raw r||s (IEEE P1363), not DER — Node's default.
    // Without dsaEncoding, every genuine Plaid signature fails to verify.
    const signingInput = `${headerB64}.${payloadB64}`;
    const verified = crypto.verify(
      "sha256",
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signatureB64, "base64url")
    );

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    // Reject replayed webhooks: Plaid documents a 5-minute freshness window.
    const issuedAt = typeof payload.iat === "number" ? payload.iat : 0;
    if (Math.abs(Date.now() / 1000 - issuedAt) > 5 * 60) return false;

    const bodyHash = crypto.createHash("sha256").update(bodyText).digest("hex");
    const hashMatches =
      typeof payload.request_body_sha256 === "string" &&
      safeEqual(payload.request_body_sha256, bodyHash);

    return verified && hashMatches;
  } catch (err) {
    logError("webhook.verify", err);
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
  if (item) await syncItemTransactions(item);
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
  if (!item) return;
  if (body.webhook_code === "ERROR") {
    const code =
      typeof body.error?.error_code === "string"
        ? body.error.error_code
        : "ITEM_ERROR";
    await setItemStatus(item.id, "error", code);
  } else if (body.webhook_code === "PENDING_EXPIRATION") {
    await setItemStatus(item.id, "active", "PENDING_EXPIRATION");
  } else if (body.webhook_code === "LOGIN_REPAIRED") {
    await setItemStatus(item.id, "active", null);
  } else if (body.webhook_code === "USER_PERMISSION_REVOKED") {
    await setItemStatus(item.id, "disconnected", "USER_PERMISSION_REVOKED");
  }
}

/**
 * Handles incoming Plaid webhooks. Syncs transactions on demand when Plaid notifies
 * us that new sync updates are available.
 */
export async function POST(req: NextRequest) {
  try {
    const bodyText = await req.text();
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

    if (body.webhook_type === "TRANSACTIONS" && body.webhook_code === "SYNC_UPDATES_AVAILABLE") {
      if (!body.item_id) {
        return badRequest("Missing item_id in webhook body");
      }
    }

    // Holdings changed (or the initial historical pull finished): a bounded,
    // item-scoped refresh. Gated on investmentsPage — before its migration is
    // applied, `holdings` doesn't exist to write to.
    await handleTransactionWebhook(body);
    await handleHoldingsWebhook(body);

    // ITEM lifecycle: mark broken connections so Settings can offer the
    // update-mode "Reconnect" flow, and clear the flag when Plaid says the
    // login was repaired on its own.
    await handleItemWebhook(body);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse("api/plaid/webhook", err);
  }
}
