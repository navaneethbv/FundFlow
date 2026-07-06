import { NextResponse, type NextRequest } from "next/server";
import { CountryCode, Products } from "plaid";
import type { LinkTokenCreateRequest } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { serverEnv } from "@/lib/env.server";
import { requireUser, errorResponse } from "@/lib/http";
import { getItem, decryptItemToken } from "@/lib/plaid-service";

/**
 * Create a Plaid Link token. Two modes:
 * - No body / no item_id: normal mode, to connect a new bank.
 * - { item_id }: update mode for an existing (broken/expiring) item — the
 *   token is created against the item's access token so Link repairs the
 *   connection instead of creating a new one. Ownership is enforced by
 *   getItem's user_id scope.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  // Body is optional (the connect button sends none).
  let itemId: string | null = null;
  try {
    const body = await request.json();
    if (body && typeof body.item_id === "string" && body.item_id.length > 0) {
      itemId = body.item_id;
    }
  } catch {
    // No/invalid JSON body → normal mode.
  }

  try {
    const plaid = getPlaidClient();

    const req: LinkTokenCreateRequest = {
      user: { client_user_id: user.id },
      client_name: "FundFlow",
      country_codes: serverEnv.plaidCountryCodes as unknown as CountryCode[],
      language: "en",
      products: [],
    };

    // Register the webhook for real-time updates, but only for a reachable
    // https origin — a localhost dev URL is unreachable and Plaid rejects it.
    const appUrl = serverEnv.appUrl;
    if (appUrl && appUrl.startsWith("https://")) {
      req.webhook = `${appUrl}/api/plaid/webhook`;
    }
    // OAuth banks (most large US institutions in production) need a registered
    // redirect_uri. Included only when configured; sandbox / non-OAuth links
    // work without it. Applies to both normal and update (reconnect) mode.
    if (serverEnv.plaidRedirectUri) {
      req.redirect_uri = serverEnv.plaidRedirectUri;
    }

    if (itemId) {
      const item = await getItem(user.id, itemId);
      if (!item) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      // Update mode: pass the access token, omit products.
      req.access_token = decryptItemToken(item);
      delete (req as { products?: unknown }).products;
    } else {
      req.products = serverEnv.plaidProducts as unknown as Products[];
      // Pull the maximum history Plaid allows (24 months; institution
      // permitting) on the initial sync. Applies per-link — already-connected
      // banks keep whatever depth they were linked with. From then on our own
      // DB retains everything forever, so history only grows.
      req.transactions = { days_requested: 730 };
    }

    const response = await plaid.linkTokenCreate(req);
    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error) {
    return errorResponse("plaid.link-token", error);
  }
}
