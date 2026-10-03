import { parseLookthroughData, type ConstituentWeight } from "@/lib/portfolio-lookthrough";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PortfolioLookthroughInput {
  holdingId: string;
  version: number;
  data: { weights: ConstituentWeight[]; asOfDate: string } | null;
}

export function parsePortfolioLookthroughInput(body: unknown): PortfolioLookthroughInput | string {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return "Reload the holding before saving.";
  const value = body as Record<string, unknown>;
  const version = value.version;
  if (typeof value.holdingId !== "string" || !UUID_RE.test(value.holdingId)
    || typeof version !== "number" || !Number.isInteger(version) || version < 0 || version >= 2147483646) {
    return "Reload the holding before saving.";
  }
  if (value.data === null) return { holdingId: value.holdingId, version, data: null };
  const parsed = parseLookthroughData(value.data);
  if (!parsed.ok) return parsed.error;
  return { holdingId: value.holdingId, version, data: { weights: parsed.weights, asOfDate: parsed.asOfDate } };
}
