import { config } from "dotenv";

// Load local env for tests (encryption key, Supabase keys for integration).
config({ path: ".env.local" });

/**
 * Safety guard preventing integration or destructive tests from running
 * against known production databases.
 */
export function assertSafeTestDatabase(url?: string): void {
  const targetUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const productionHost = process.env.PRODUCTION_SUPABASE_URL || process.env.FUNDFLOW_PROD_URL;
  if (productionHost && targetUrl && targetUrl.includes(productionHost)) {
    throw new Error(
      `Refusing to run tests against designated production database: ${targetUrl}`,
    );
  }
}
