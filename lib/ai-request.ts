import "server-only";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/log";

export async function runMeteredAiRequest<T>(
  route: "ask" | "receipt",
  userId: string,
  operation: () => Promise<T>,
): Promise<T | NextResponse> {
  const options = { failClosed: true };
  const allowed = await checkRateLimit(`ai-${route}-attempt:${userId}`, 3, 60, options);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const day = new Date().toISOString().slice(0, 10);
  const key = `ai-${route}:${userId}:${day}`;
  if (!await checkRateLimit(key, 10, 24 * 3600, options)) {
    const kind = route === "ask" ? "question" : "scan";
    return NextResponse.json({ error: `Daily ${kind} limit reached.` }, { status: 429 });
  }

  try {
    return await operation();
  } catch {
    // Provider errors can include input or credentials. Record the route only.
    logError(`ai.${route}.provider`, "Provider request failed");
    try {
      const { error } = await createServiceClient().rpc("refund_ai_rate_limit", { p_key: key });
      if (error) throw error;
    } catch (error) {
      logError(`ai.${route}.refund`, error);
    }
    return NextResponse.json({ error: "AI is temporarily unavailable." }, { status: 503 });
  }
}
