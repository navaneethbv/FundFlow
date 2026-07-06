import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { serverEnv } from "@/lib/env.server";

/**
 * Server-only Plaid API client. Reads client id/secret from env; these never
 * reach the browser. Built lazily so only routes that touch Plaid require the
 * Plaid env vars.
 */
let client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (client) return client;

  const basePath =
    PlaidEnvironments[serverEnv.plaidEnv] ?? PlaidEnvironments.sandbox;

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": serverEnv.plaidClientId,
        "PLAID-SECRET": serverEnv.plaidSecret,
      },
    },
  });

  client = new PlaidApi(configuration);
  return client;
}
