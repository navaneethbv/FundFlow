import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env.server";

/**
 * Real AI insights (Phase 3): a server-only Anthropic client behind the
 * privacy contract. The ONLY data that crosses the wire is what the CSV
 * export already exposes — month/category/merchant aggregates. Never
 * balances, account names, masks, emails, or transaction-level rows.
 *
 * Opt-in twice: the profile's export flag AND ai_settings.enabled. Without
 * ANTHROPIC_API_KEY the app falls back to the built-in rule-based
 * summaries — the feature degrades, never breaks.
 */

export function isAiProviderConfigured(): boolean {
  return Boolean(serverEnv.anthropicApiKey);
}

export interface ProviderInsight {
  insightType: string;
  sourceMonth: string | null;
  summary: string;
}

interface AggregateRow {
  month?: string;
  merchant?: string;
  category?: string;
  amount?: number;
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
    if (amount <= 0) continue; // spending only
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

  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  const response = await client.messages.create({
    model: process.env.AI_INSIGHTS_MODEL ?? "claude-opus-4-8",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
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
  });

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
