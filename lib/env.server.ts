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
  get tokenEncKey() {
    return required("PLAID_TOKEN_ENC_KEY", process.env.PLAID_TOKEN_ENC_KEY);
  },
  get cronSecret() {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
};
