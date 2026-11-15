import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env.server";
import { TRANSFER_GROUPS, type FinanceFlow } from "@/lib/finance-domain";

/**
 * Real AI provider integration: a server-only Anthropic client behind the
 * privacy contract. The ONLY data that crosses the wire is what the CSV
 * export already exposes — month/category/merchant aggregates. Never
 * balances, account names, masks, emails, or transaction-level rows.
 *
 * Opt-in twice: the profile's export flag AND ai_settings.enabled. Without
 * ANTHROPIC_API_KEY the app falls back to the built-in rule-based
 * summaries — the feature degrades, never breaks.
 */

export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

export function getAiModel(): string {
  return process.env.AI_INSIGHTS_MODEL ?? DEFAULT_AI_MODEL;
}

function getAnthropicClient(timeout = 30_000): Anthropic {
  return new Anthropic({ apiKey: serverEnv.anthropicApiKey, timeout, maxRetries: 1 });
}

function logUsage(route: string, usage: Anthropic.Usage | undefined): void {
  if (usage) console.info(`[ai.${route}.usage]`, {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
  });
}

export function isAiProviderConfigured(): boolean {
  return Boolean(serverEnv.anthropicApiKey);
}

export interface ProviderInsight {
  insightType: string;
  sourceMonth: string | null;
  summary: string;
}

export interface AggregateRow {
  month?: string;
  merchant?: string;
  category?: string;
  amount?: number;
  flow?: FinanceFlow;
}

const MAX_MERCHANTS = 25;
const MAX_MONTHS = 6;

/** Compact the export rows into bounded aggregates before they leave the app. */
export function buildInsightPayload(rows: AggregateRow[]) {
  const byMonthCategory = new Map<string, number>();
  // Merchants accumulate per month so the 6-month window below can drop
  // out-of-window spend before ranking; a global per-merchant total would
  // smuggle dropped months back into the payload.
  const byMonthMerchant = new Map<string, number>();
  const months = new Set<string>();

  for (const row of rows) {
    const amount = row.amount ?? 0;
    // Spending only: use the canonical flow when present, otherwise retain
    // the legacy Plaid-sign fallback for callers that still provide raw rows.
    if (row.flow ? row.flow !== "expense" : amount <= 0) continue;
    const catUpper = (row.category ?? "").toUpperCase();
    if (
      (catUpper === "TRANSFER" || TRANSFER_GROUPS.has(catUpper)) ||
      row.flow === "transfer"
    ) {
      continue;
    }
    const month = row.month ?? "unknown";
    months.add(month);
    const category = row.category ?? "UNCATEGORIZED";
    // Keep the signed amount. Plaid's convention is positive = money out, so a
    // credit against an expense category (a refund, a returned charge) is
    // negative and must reduce the total. Math.abs() here turned a $20 refund
    // into $20 more spending, so a $100 charge plus a $20 refund reported $120.
    byMonthCategory.set(
      `${month}|${category}`,
      (byMonthCategory.get(`${month}|${category}`) ?? 0) + amount,
    );
    if (row.merchant) {
      byMonthMerchant.set(
        `${month}|${row.merchant}`,
        (byMonthMerchant.get(`${month}|${row.merchant}`) ?? 0) + amount,
      );
    }
  }

  // Month keys are YYYY-MM, so an explicit lexicographic compare is also
  // chronological.
  const keepMonths = new Set(
    [...months].sort((a, b) => a.localeCompare(b)).slice(-MAX_MONTHS),
  );
  const merchantTotals = new Map<string, number>();
  for (const [key, amount] of byMonthMerchant) {
    const separator = key.indexOf("|");
    const month = key.slice(0, separator);
    if (!keepMonths.has(month)) continue;
    const merchant = key.slice(separator + 1);
    merchantTotals.set(merchant, (merchantTotals.get(merchant) ?? 0) + amount);
  }
  return {
    // A net-zero month/category or merchant carries no signal and would only
    // invite the model to comment on a $0 line, so those are dropped. Net
    // credits stay, as a negative, because they are real.
    monthly_category_spend: [...byMonthCategory.entries()]
      .map(([key, amount]) => {
        const [month, category] = key.split("|");
        return { month, category, amount: Math.round(amount * 100) / 100 };
      })
      .filter((row) => keepMonths.has(row.month!) && row.amount !== 0),
    top_merchants: [...merchantTotals.entries()]
      .map(([merchant, amount]) => ({ merchant, amount: Math.round(amount * 100) / 100 }))
      .filter((row) => row.amount !== 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, MAX_MERCHANTS),
  };
}

const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          insight_type: {
            type: "string",
            enum: ["what_changed", "save_100", "subscription_audit"],
          },
          summary: { type: "string" },
        },
        required: ["insight_type", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "You are a personal-finance analyst inside FundFlow, a privacy-first app.",
  "You receive ONLY spending aggregates: monthly category totals and top merchants.",
  "Produce exactly three insights, each grounded strictly in the provided numbers:",
  '1. insight_type "what_changed": the most meaningful month-over-month shift, with figures.',
  '2. insight_type "save_100": the most realistic concrete path to save about $100/month.',
  '3. insight_type "subscription_audit": what the merchant list suggests about recurring spend worth reviewing.',
  "Each summary: 1-3 sentences, plain language, specific dollar figures from the data, no invented facts, no financial-product recommendations.",
].join("\n");

export async function generateInsightsWithProvider(input: {
  rows: AggregateRow[];
}): Promise<ProviderInsight[]> {
  const payload = buildInsightPayload(input.rows);
  const latestMonth =
    payload.monthly_category_spend
      .map((row) => row.month!)
      .sort((a, b) => a.localeCompare(b))
      .at(-1) ?? null;

  const client = getAnthropicClient();
  const model = getAiModel();
  const requestOptions: Anthropic.MessageCreateParams = {
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: INSIGHT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Spending aggregates:\n${JSON.stringify(payload)}`,
      },
    ],
  };

  const response = await client.messages.create(requestOptions);

  logUsage("insights", response.usage);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    throw new Error("AI insight output was incomplete");
  }
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) throw new Error("ai-provider empty response");

  const parsed = JSON.parse(textBlock.text);
  const kinds = INSIGHT_SCHEMA.properties.insights.items.properties.insight_type.enum;
  if (!Array.isArray(parsed?.insights) || parsed.insights.length > kinds.length) {
    throw new Error("Invalid AI insight output");
  }
  const insights: Array<{ insight_type: string; summary: string }> = parsed.insights;
  for (const insight of insights) {
    if (!insight || !kinds.some((kind) => kind === insight.insight_type) || typeof insight.summary !== "string") {
      throw new Error("Invalid AI insight");
    }
  }
  return insights.map((insight) => ({
    insightType: insight.insight_type,
    sourceMonth: latestMonth,
    summary: insight.summary.slice(0, 1200),
  }));
}

/**
 * Ask AI about spending aggregates: centralized in ai-provider.
 */
export async function answerSpendingQuestionWithProvider(input: {
  question: string;
  payload: ReturnType<typeof buildInsightPayload>;
}): Promise<{ answer: string; refusal?: boolean }> {
  const client = getAnthropicClient();
  const model = getAiModel();
  const requestOptions: Anthropic.MessageCreateParams = {
    model,
    max_tokens: 600,
    system:
      "You answer one question about the user's own spending using ONLY the provided aggregates (monthly category totals and top merchants). If the aggregates cannot answer the question, say so plainly. 1-4 sentences, specific dollar figures, no advice about financial products, no invented data.",
    messages: [
      {
        role: "user",
        content: `Aggregates:\n${JSON.stringify(input.payload)}\n\nQuestion: ${input.question}`,
      },
    ],
  };

  const response = await client.messages.create(requestOptions);

  logUsage("ask", response.usage);
  if (response.stop_reason === "max_tokens") {
    return { answer: "The answer was cut short. Try asking a more specific question." };
  }
  if (response.stop_reason === "refusal") {
    return { answer: "I can't help with that question.", refusal: true };
  }
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return { answer: textBlock?.text ?? "No answer produced." };
}

export const RECEIPT_SCHEMA = {
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

export interface ExtractedReceiptData {
  merchant: string;
  amount: number;
  date: string;
  line_items: string[];
}

export type ReceiptImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

const KNOWN_IMAGE_TYPES: Record<string, ReceiptImageMediaType> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

/**
 * Extract receipt data from an image: centralized in ai-provider.
 */
export async function extractReceiptWithProvider(input: {
  fileBase64: string;
  mediaType: string;
}): Promise<{ extracted: ExtractedReceiptData | null; refusal?: boolean }> {
  const client = getAnthropicClient(45_000);
  const model = getAiModel();
  const resolvedMediaType: ReceiptImageMediaType =
    KNOWN_IMAGE_TYPES[input.mediaType] ?? "image/jpeg";

  const requestOptions: Anthropic.MessageCreateParams = {
    model,
    max_tokens: 1024,
    system:
      "Extract the receipt's merchant name, total amount (number), purchase date (YYYY-MM-DD), and up to 15 short line-item descriptions. If a field is unreadable, use your best guess for merchant, 0 for amount, and today's implied date only if printed.",
    output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: resolvedMediaType,
              data: input.fileBase64,
            },
          },
          { type: "text", text: "Extract this receipt." },
        ],
      },
    ],
  };

  const response = await client.messages.create(requestOptions);

  logUsage("receipt", response.usage);
  if (response.stop_reason === "max_tokens") throw new Error("AI receipt output was incomplete");
  if (response.stop_reason === "refusal") {
    return { extracted: null, refusal: true };
  }
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) throw new Error("receipt: empty response");

  const parsed = JSON.parse(textBlock.text);
  if (typeof parsed?.merchant !== "string" || typeof parsed.date !== "string" ||
      typeof parsed.amount !== "number" || !Number.isFinite(parsed.amount) ||
      !Array.isArray(parsed.line_items) || parsed.line_items.some((item: unknown) => typeof item !== "string")) {
    throw new Error("Invalid AI receipt output");
  }
  return { extracted: {
    merchant: parsed.merchant.slice(0, 180),
    amount: parsed.amount >= 0 && parsed.amount <= 1_000_000 ? parsed.amount : 0,
    date: parsed.date.slice(0, 32),
    line_items: parsed.line_items.slice(0, 15).map((item: string) => item.slice(0, 240)),
  } };
}
