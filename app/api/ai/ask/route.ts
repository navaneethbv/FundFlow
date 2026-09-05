import { NextResponse, type NextRequest } from "next/server";
import {
  answerSpendingQuestionWithProvider,
  buildInsightPayload,
  isAiProviderConfigured,
} from "@/lib/ai-provider";
import { fetchPrivacySafeRows, recentHistoryStart } from "@/lib/export";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * "Ask your money" (Bucket 2): one-shot Q&A over the same privacy-safe
 * aggregates the AI insights use. No chat history, no memory — question in,
 * grounded answer out. Same double consent as insights, 10 questions/day.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    if (!isAiProviderConfigured()) {
      return NextResponse.json(
        { error: "AI is not configured on this deployment." },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => null)) as { question?: string } | null;
    const question = body?.question?.trim();
    if (!question || question.length > 300) {
      return badRequest("A question of up to 300 characters is required");
    }

    const [{ data: settings }, exportResult] = await Promise.all([
      supabase.from("ai_settings").select("enabled").eq("user_id", user.id).maybeSingle(),
      fetchPrivacySafeRows(supabase, user.id, { startDate: recentHistoryStart() }),
    ]);
    if (exportResult.allowed === false || settings?.enabled !== true) {
      return NextResponse.json(
        { error: "Enable AI insights in Settings first." },
        { status: 403 },
      );
    }

    const allowed = await checkRateLimit(`ai-ask:${user.id}`, 10, 24 * 3600);
    if (!allowed) {
      return NextResponse.json(
        { error: "Daily question limit reached." },
        { status: 429 },
      );
    }

    const payload = buildInsightPayload(
      exportResult.rows.map((row) => ({
        month: row.date.slice(0, 7),
        merchant: row.merchant,
        category: row.category,
        amount: row.amount,
      })),
    );

    const { answer } = await answerSpendingQuestionWithProvider({
      question,
      payload,
    });

    await writeAudit({
      userId: user.id,
      action: "ai_question",
      metadata: { length: question.length },
      ip: getClientIp(request),
    });

    return NextResponse.json({ answer });
  } catch (error) {
    return errorResponse("ai.ask", error);
  }
}
