import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Privileged Supabase client using the secret key. Bypasses RLS, so it must only
 * be used in trusted server code, and every query MUST scope by user_id
 * explicitly. Use for writes that RLS intentionally blocks from the browser:
 * storing encrypted Plaid tokens, upserting synced accounts/transactions, and
 * writing audit logs.
 */
export function createServiceClient() {
  return createSupabaseClient(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
