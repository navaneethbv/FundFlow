import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getPlaidClient } from "@/lib/plaid";
import { syncItemTransactions } from "@/lib/sync";
import { createServiceClient } from "@/lib/supabase/service";
import { errorResponse, badRequest } from "@/lib/http";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

async function verifyPlaidWebhook(req: NextRequest, bodyText: string): Promise<boolean> {
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
  if (plaidEnv === "sandbox" || process.env.NODE_ENV === "test") {
    return true;
  }

  const verificationHeader = req.headers.get("plaid-verification");
  if (!verificationHeader) return false;

  try {
    const parts = verificationHeader.split(".");
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
    const { kid } = header;
    if (!kid) return false;

    const plaid = getPlaidClient();
    const response = await plaid.webhookVerificationKeyGet({
      key_id: kid,
    });

    const publicKey = crypto.createPublicKey({
      format: "jwk",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      key: response.data.key as any,
    });

    const signingInput = `${headerB64}.${payloadB64}`;
    const verified = crypto.verify(
      undefined,
      Buffer.from(signingInput),
      publicKey,
      Buffer.from(signatureB64, "base64url")
    );

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    const bodyHash = crypto.createHash("sha256").update(bodyText).digest("hex");
    const hashMatches = payload.request_body_sha256 === bodyHash;

    return verified && hashMatches;
  } catch (err) {
    logError("webhook.verify", err);
    return false;
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

    const body = JSON.parse(bodyText);
    const { webhook_type, webhook_code, item_id } = body;

    if (webhook_type === "TRANSACTIONS" && webhook_code === "SYNC_UPDATES_AVAILABLE") {
      if (!item_id) {
        return badRequest("Missing item_id in webhook body");
      }

      const service = createServiceClient();
      const { data: item, error: itemError } = await service
        .from("plaid_items")
        .select("*")
        .eq("plaid_item_id", item_id)
        .maybeSingle();

      if (itemError) throw itemError;

      if (item) {
        // Incrementally sync transactions in the background
        await syncItemTransactions(item);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse("api/plaid/webhook", err);
  }
}
