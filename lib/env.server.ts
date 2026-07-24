import "server-only";

/**
 * Server-only secrets. Importing this module from client code is a build error
 * (via the "server-only" package), so these values can never reach the browser.
 *
 * Accessors are lazy getters: validation runs when a value is read at request
 * time, not at module import. This keeps `next build` from failing just because
 * a not-yet-configured var (e.g. Plaid keys) is absent in the build environment.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function csv(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const serverEnv = {
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
  },
  get plaidClientId() {
    return required("PLAID_CLIENT_ID", process.env.PLAID_CLIENT_ID);
  },
  get plaidSecret() {
    return required("PLAID_SECRET", process.env.PLAID_SECRET);
  },
  get plaidEnv() {
    return process.env.PLAID_ENV ?? "sandbox";
  },
  get plaidProducts() {
    return csv(process.env.PLAID_PRODUCTS, "transactions");
  },
  get plaidCountryCodes() {
    return csv(process.env.PLAID_COUNTRY_CODES, "US");
  },
  // Public base URL of the deployed app. Used to register the Plaid webhook on
  // new link tokens (only when it is a real https origin — never localhost).
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL;
  },
  // Optional. When set, passed as the Plaid Link redirect_uri so OAuth banks can
  // return to the app. Must exactly match a redirect URI registered in the Plaid
  // dashboard. Leave unset for sandbox / non-OAuth institutions.
  get plaidRedirectUri() {
    return process.env.PLAID_REDIRECT_URI;
  },
  get tokenEncKey() {
    return required("PLAID_TOKEN_ENC_KEY", process.env.PLAID_TOKEN_ENC_KEY);
  },
  get cronSecret() {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
  // Optional: 32-byte base64 key for encrypted takeout backups (2.1).
  // Deliberately distinct from PLAID_TOKEN_ENC_KEY — a leaked backup key
  // must not unlock bank tokens. The backup cron fails closed without it.
  get backupEncKey() {
    return process.env.BACKUP_ENC_KEY;
  },
  // Optional: enables the in-app AI insights provider (Phase 3). Without
  // it, insight generation returns a clear "not configured" state.
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY;
  },
};
