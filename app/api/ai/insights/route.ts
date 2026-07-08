import { NextResponse } from "next/server";
import { generateAiInsightSummaries } from "@/lib/ai-insights";
import { fetchPrivacySafeRows } from "@/lib/export";
import { errorResponse, requireUser } from "@/lib/http";
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

    const insights = generateAiInsightSummaries({
      enabled: true,
      rows: exportResult.rows.map((row) => ({
        month: row.date.slice(0, 7),
        merchant: row.merchant,
        category: row.category,
        amount: row.amount,
      })),
    });

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
