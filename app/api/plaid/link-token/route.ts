import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { serverEnv } from "@/lib/env.server";
import { requireUser, errorResponse } from "@/lib/http";

export async function POST() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const plaid = getPlaidClient();
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "FundFlow",
      products: serverEnv.plaidProducts as unknown as Products[],
      country_codes: serverEnv.plaidCountryCodes as unknown as CountryCode[],
      language: "en",
    });
    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error) {
    return errorResponse("plaid.link-token", error);
  }
}
