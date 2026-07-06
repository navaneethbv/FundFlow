import { NextResponse, type NextRequest } from "next/server";
import { CountryCode } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { serverEnv } from "@/lib/env.server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { storeItem, getItem, upsertAccounts } from "@/lib/plaid-service";
import { syncItemTransactions } from "@/lib/sync";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  // Rate limit the token exchange: 10 attempts / minute per user.
  const allowed = await checkRateLimit(`exchange:${user.id}`, 10, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const publicToken = (body as { public_token?: unknown }).public_token;
  if (typeof publicToken !== "string" || publicToken.length === 0) {
    return badRequest("public_token is required");
  }

  const ip = getClientIp(request);

  try {
    const plaid = getPlaidClient();

    // Exchange the short-lived public_token for a durable access_token.
    const exchange = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const plaidItemId = exchange.data.item_id;

    // Best-effort institution metadata (name is nice-to-have, not required).
    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      const itemResp = await plaid.itemGet({ access_token: accessToken });
      institutionId = itemResp.data.item.institution_id ?? null;
      if (institutionId) {
        const inst = await plaid.institutionsGetById({
          institution_id: institutionId,
          country_codes: serverEnv.plaidCountryCodes as unknown as CountryCode[],
        });
        institutionName = inst.data.institution.name ?? null;
      }
    } catch (error) {
      logError("plaid.exchange.institution", error);
    }

    // Encrypt + store the access token. Plaintext is discarded after this.
    const itemDbId = await storeItem({
      userId: user.id,
      plaidItemId,
      accessToken,
      institutionId,
      institutionName,
    });

    await writeAudit({
      userId: user.id,
      action: "plaid_token_exchange",
      metadata: { institution_name: institutionName },
      ip,
    });

    // Pull accounts, then do an initial transaction sync.
    const accountsResp = await plaid.accountsGet({ access_token: accessToken });
    await upsertAccounts(user.id, itemDbId, accountsResp.data.accounts);

    const item = await getItem(user.id, itemDbId);
    if (item) {
      try {
        await syncItemTransactions(item);
      } catch (error) {
        // Initial data may not be ready yet; the daily cron will catch up.
        logError("plaid.exchange.initial-sync", error);
      }
    }

    await writeAudit({
      userId: user.id,
      action: "plaid_connect",
      metadata: { institution_name: institutionName },
      ip,
    });

    return NextResponse.json({ ok: true, institution_name: institutionName });
  } catch (error) {
    return errorResponse("plaid.exchange", error);
  }
}
