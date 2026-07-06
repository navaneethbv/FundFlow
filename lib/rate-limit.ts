import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/log";

/**
 * Fixed-window rate limit check via the Postgres rate_limit_hit() function.
 * Returns true if the request is allowed. Fails OPEN on error (never blocks a
 * legitimate user because the limiter itself failed) but logs the failure.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    logError("rate-limit", error);
    return true;
  }
}
