import { NextResponse, type NextRequest } from "next/server";
import { CountryCode } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { serverEnv } from "@/lib/env.server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { storeItem, getItem, upsertAccounts, consumeLinkToken } from "@/lib/plaid-service";
import { syncItemTransactions } from "@/lib/sync";
import { writeAudit, getClientIp } from "@/lib/audit";
import { logError } from "@/lib/log";
import { fetchInstitutionBranding } from "@/lib/plaid-institution";

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
  const linkToken = (body as { link_token?: unknown }).link_token;
  if (typeof linkToken !== "string" || linkToken.length === 0) {
    return badRequest("link_token is required");
  }

  const ip = getClientIp(request);

  try {
    const plaid = getPlaidClient();

    // Bind the exchange to a link token this user actually created. The
    // hashed, single-use record is the authoritative gate; linkTokenGet
    // additionally proves the public token was minted by this exact link
    // token when Plaid has session data available.
    try {
      const tokenInfo = await plaid.linkTokenGet({ link_token: linkToken });
      const mintedPublicTokens = (tokenInfo.data.link_sessions ?? [])
        .map((session) => session.on_success?.public_token)
        .filter((token): token is string => typeof token === "string");
      if (
        mintedPublicTokens.length > 0 &&
        !mintedPublicTokens.includes(publicToken)
      ) {
        return badRequest("Public token does not match this link token");
      }
    } catch (error) {
      // linkTokenGet is best-effort (session data can lag); the hash-bound
      // single-use check below remains the authoritative control.
      logError("plaid.exchange.linkTokenGet", error);
    }

    const linkOk = await consumeLinkToken(user.id, linkToken);
    if (!linkOk) {
      return badRequest("Invalid or already-used link token");
    }

    // Exchange the short-lived public_token for a durable access_token.
    const exchange = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const plaidItemId = exchange.data.item_id;

    // Best-effort institution metadata (name is nice-to-have, not required).
    let institutionId: string | null = null;
    let institutionName: string | null = null;
    let institutionLogo: string | null = null;
    let institutionBrandColor: string | null = null;
    try {
      const itemResp = await plaid.itemGet({ access_token: accessToken });
      institutionId = itemResp.data.item.institution_id ?? null;
      if (institutionId) {
        const branding = await fetchInstitutionBranding(plaid, {
          institutionId,
          countryCodes: serverEnv.plaidCountryCodes as unknown as CountryCode[],
        });
        institutionName = branding?.name ?? null;
        institutionLogo = branding?.logo ?? null;
        institutionBrandColor = branding?.brandColor ?? null;
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
      institutionLogo,
      institutionBrandColor,
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
