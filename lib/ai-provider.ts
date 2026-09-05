import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env.server";

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

export const DEFAULT_AI_MODEL = "claude-3-5-sonnet-20241022";

export function getAiModel(): string {
  return process.env.AI_INSIGHTS_MODEL ?? DEFAULT_AI_MODEL;
}

function supportsAdaptiveThinking(model: string): boolean {
  return model.includes("3-7") || model.includes("opus");
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: serverEnv.anthropicApiKey });
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
  flow?: string;
}

const MAX_MERCHANTS = 25;
const MAX_MONTHS = 6;

/** Compact the export rows into bounded aggregates before they leave the app. */
export function buildInsightPayload(rows: AggregateRow[]) {
  const byMonthCategory = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  const months = new Set<string>();

  for (const row of rows) {
    const amount = row.amount ?? 0;
    // Spending only: positive amount in Plaid sign convention, excluding loan payments and transfers
    if (amount <= 0) continue;
    const catUpper = (row.category ?? "").toUpperCase();
    if (catUpper === "TRANSFER" || catUpper === "LOAN_PAYMENTS" || row.flow === "transfer") {
      continue;
    }
    const month = row.month ?? "unknown";
    months.add(month);
    const category = row.category ?? "UNCATEGORIZED";
    byMonthCategory.set(
      `${month}|${category}`,
      (byMonthCategory.get(`${month}|${category}`) ?? 0) + amount,
    );
    if (row.merchant) {
      byMerchant.set(row.merchant, (byMerchant.get(row.merchant) ?? 0) + amount);
    }
  }

  // Month keys are YYYY-MM, so an explicit lexicographic compare is also
  // chronological.
  const keepMonths = new Set(
    [...months].sort((a, b) => a.localeCompare(b)).slice(-MAX_MONTHS),
  );
  return {
    monthly_category_spend: [...byMonthCategory.entries()]
      .map(([key, amount]) => {
        const [month, category] = key.split("|");
        return { month, category, amount: Math.round(amount * 100) / 100 };
      })
      .filter((row) => keepMonths.has(row.month!)),
    top_merchants: [...byMerchant.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_MERCHANTS)
      .map(([merchant, amount]) => ({ merchant, amount: Math.round(amount * 100) / 100 })),
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
    ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" } } : {}),
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

  if (response.stop_reason === "refusal") {
    throw new Error("ai-provider refusal");
  }
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) throw new Error("ai-provider empty response");

  const parsed = JSON.parse(textBlock.text) as {
    insights: { insight_type: string; summary: string }[];
  };
  return parsed.insights.map((insight) => ({
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
    ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" } } : {}),
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
  const client = getAnthropicClient();
  const model = getAiModel();
  const resolvedMediaType: ReceiptImageMediaType =
    KNOWN_IMAGE_TYPES[input.mediaType] ?? "image/jpeg";

  const requestOptions: Anthropic.MessageCreateParams = {
    model,
    max_tokens: 1024,
    ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" } } : {}),
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

  if (response.stop_reason === "refusal") {
    return { extracted: null, refusal: true };
  }
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) throw new Error("receipt: empty response");

  const parsed = JSON.parse(textBlock.text) as ExtractedReceiptData;
  return { extracted: parsed };
}
