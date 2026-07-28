import { NextResponse } from "next/server";
import { generateAiInsightSummaries } from "@/lib/ai-insights";
import {
  generateInsightsWithProvider,
  isAiProviderConfigured,
} from "@/lib/ai-provider";
import { fetchPrivacySafeRows } from "@/lib/export";
import { errorResponse, requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const [{ data: settings }, exportResult] = await Promise.all([
      supabase.from("ai_settings").select("enabled").eq("user_id", user.id).maybeSingle(),
      fetchPrivacySafeRows(supabase, user.id),
    ]);
    if (exportResult.allowed === false || settings?.enabled !== true) {
      return NextResponse.json({ insights: [] });
    }

    const rows = exportResult.rows.map((row) => ({
      month: row.date.slice(0, 7),
      merchant: row.merchant,
      category: row.category,
      amount: row.amount,
    }));

    // Provider path (Phase 3): real model-generated insights over the same
    // privacy-safe aggregates, hard-capped to 4 generations/day per user so
    // a stuck retry loop can never run up a bill. Any provider failure
    // falls back to the built-in rule-based summaries — never a 500.
    let insights: Array<{
      insightType: string;
      sourceMonth: string | null;
      summary: string;
    }> | null = null;
    if (isAiProviderConfigured()) {
      const allowed = await checkRateLimit(`ai-insights:${user.id}`, 4, 24 * 3600);
      if (allowed) {
        try {
          insights = await generateInsightsWithProvider({ rows });
        } catch (providerError) {
          logError("ai.insights.provider", providerError);
        }
      }
    }
    insights ??= generateAiInsightSummaries({ enabled: true, rows });

    const service = createServiceClient();
    const { error } = await service.from("ai_insights").insert(
      insights.map((insight) => ({
        user_id: user.id,
        insight_type: insight.insightType,
        summary: insight.summary,
        source_month: insight.sourceMonth ? `${insight.sourceMonth}-01` : null,
      })),
    );
    if (error) throw error;

    return NextResponse.json({ insights });
  } catch (error) {
    return errorResponse("ai.insights", error);
  }
}
