import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { isAiProviderConfigured } from "@/lib/ai-provider";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env.server";
import { writeAudit, getClientIp } from "@/lib/audit";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string" },
    amount: { type: "number" },
    date: { type: "string" },
    line_items: { type: "array", items: { type: "string" } },
  },
  required: ["merchant", "amount", "date", "line_items"],
  additionalProperties: false,
} as const;

/**
 * Receipt scanning (Bucket 2): a receipt photo goes to the vision model,
 * which extracts merchant/amount/date/line items; the route then looks for
 * a matching ledger transaction (amount ±1%, date ±3 days). The image
 * leaves the app — that's why this sits behind the same double consent as
 * AI insights, is rate-limited (10/day), and is never automatic. The image
 * is never stored; the extraction is returned to the client, which decides
 * whether to attach it as a note via the existing annotate route.
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

    const { data: settings } = await supabase
      .from("ai_settings")
      .select("enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (settings?.enabled !== true) {
      return NextResponse.json(
        { error: "Enable AI insights in Settings first." },
        { status: 403 },
      );
    }

    const allowed = await checkRateLimit(`ai-receipt:${user.id}`, 10, 24 * 3600);
    if (!allowed) {
      return NextResponse.json({ error: "Daily scan limit reached." }, { status: 429 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return badRequest("file is required");
    if (file.size > MAX_IMAGE_BYTES) return badRequest("Image too large (5 MB max)");
    const mediaType = file.type;
    if (!IMAGE_TYPES.has(mediaType)) return badRequest("Unsupported image type");

    const data = Buffer.from(await file.arrayBuffer()).toString("base64");

    const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
    const response = await client.messages.create({
      model: process.env.AI_INSIGHTS_MODEL ?? "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system:
        "Extract the receipt's merchant name, total amount (number), purchase date (YYYY-MM-DD), and up to 15 short line-item descriptions. If a field is unreadable, use your best guess for merchant, 0 for amount, and today's implied date only if printed.",
      output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg", data },
            },
            { type: "text", text: "Extract this receipt." },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The image could not be processed." }, { status: 422 });
    }
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    if (!textBlock) throw new Error("receipt: empty response");
    const extracted = JSON.parse(textBlock.text) as {
      merchant: string;
      amount: number;
      date: string;
      line_items: string[];
    };

    // Match against the ledger: amount within 1%, date within ±3 days.
    let matchedTransactionId: string | null = null;
    if (extracted.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
      const spread = Math.max(0.01, extracted.amount * 0.01);
      const from = new Date(extracted.date);
      from.setUTCDate(from.getUTCDate() - 3);
      const to = new Date(extracted.date);
      to.setUTCDate(to.getUTCDate() + 3);
      const { data: candidates } = await supabase
        .from("transactions")
        .select("id, date, amount, merchant_name, name")
        .gte("date", from.toISOString().slice(0, 10))
        .lte("date", to.toISOString().slice(0, 10))
        .gte("amount", extracted.amount - spread)
        .lte("amount", extracted.amount + spread)
        .limit(3);
      matchedTransactionId = (candidates?.[0]?.id as string | undefined) ?? null;
    }

    await writeAudit({
      userId: user.id,
      action: "receipt_scanned",
      metadata: { matched: Boolean(matchedTransactionId) },
      ip: getClientIp(request),
    });

    return NextResponse.json({
      merchant: extracted.merchant,
      amount: extracted.amount,
      date: extracted.date,
      lineItems: extracted.line_items.slice(0, 15),
      matchedTransactionId,
    });
  } catch (error) {
    return errorResponse("ai.receipt", error);
  }
}
